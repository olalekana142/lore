"""DB-level tests for the workspace / project / deliverable / briefing / search modules.

These run on a throwaway Kùzu graph with NO Groq calls (only the local embedding model), so
they cover the pure assembly logic: persistence, counts, status derivation, ACL filtering.
LLM-dependent paths (generate, analyze_meeting, policy checks) are exercised by the eval
harness and the live API, not here.
"""

from datetime import datetime

import kuzu
import pytest

from lore.graph.schema import NODE_TABLES, REL_TABLES


@pytest.fixture()
def conn(tmp_path):
    c = kuzu.Connection(kuzu.Database(str(tmp_path / "ws.kuzu")))
    for ddl in NODE_TABLES + REL_TABLES:
        c.execute(ddl)
    c.execute("MERGE (c:Company {id:'acme'}) SET c.name='acme'")
    # one public doc at version 2 (i.e. it has been updated), owned by HR
    c.execute(
        """MERGE (d:Document {id:'upload:travel'})
           SET d.title='Booking Business Travel', d.source='upload', d.url='', d.text='Hotels are capped at 250 dollars.',
               d.version=2, d.updated_at=$t, d.owner='HR Team', d.audience=['everyone'],
               d.authority=60, d.canonical=false, d.cited_count=0""",
        {"t": datetime(2026, 9, 1)},
    )
    c.execute("MATCH (c:Company {id:'acme'}),(d:Document {id:'upload:travel'}) MERGE (c)-[:OWNS]->(d)")
    # one HR-only doc a member must never see
    c.execute(
        """MERGE (d:Document {id:'manual:comp'})
           SET d.title='Compensation Bands', d.source='manual', d.url='', d.text='Level 5 earns 200k.',
               d.version=1, d.updated_at=$t, d.owner='', d.audience=['hr'], d.authority=60,
               d.canonical=false, d.cited_count=0""",
        {"t": datetime(2026, 8, 1)},
    )
    c.execute("MATCH (c:Company {id:'acme'}),(d:Document {id:'manual:comp'}) MERGE (c)-[:OWNS]->(d)")
    return c


def test_projects_persist_and_count(conn):
    from lore import projects

    p = projects.create_project(conn, "acme", "Enterprise Migration", "Move to the new stack")
    assert projects.list_projects(conn, "acme")[0]["name"] == "Enterprise Migration"

    added = projects.add_entries(conn, "acme", p["id"], [
        {"kind": "decision", "title": "Standardize on PostgreSQL"},
        {"kind": "action", "title": "Migrate billing DB", "owner": "Sam", "due": "Q1"},
        {"kind": "question", "title": "Do we need read replicas?"},
        {"kind": "bogus", "title": "falls back to note"},
        {"kind": "note", "title": ""},  # empty title is skipped
    ])
    assert added == 4
    detail = projects.get_project(conn, "acme", p["id"])
    assert detail["counts"] == {"decision": 1, "action": 1, "question": 1, "note": 1}
    assert projects.add_entries(conn, "acme", "proj:missing", [{"kind": "note", "title": "x"}]) == 0
    assert projects.get_project(conn, "acme", "proj:missing") is None


def test_workspace_home_derives_active_work_from_real_records(conn):
    from lore import projects, workspace

    p = projects.create_project(conn, "acme", "Enterprise Migration")
    projects.add_entries(conn, "acme", p["id"], [
        {"kind": "decision", "title": "Standardize on PostgreSQL"},
        {"kind": "question", "title": "Do we need read replicas?"},
    ])
    home = workspace.workspace_home(conn, "acme", groups=["everyone"])

    # a project with an open question is "in progress"
    prog = [w for w in home["active_work"] if w["status"] == "progress"]
    assert prog and prog[0]["title"] == "Enterprise Migration" and "1 open question" in prog[0]["context"]

    # signals: the updated doc (version 2) and the newest recorded decision
    kinds = {s["icon"] for s in home["company_signals"]}
    assert "doc" in kinds and "decision" in kinds
    assert any("Booking Business Travel updated" in s["title"] for s in home["company_signals"])

    # recent work lists project memory with its item count
    proj_rows = [r for r in home["recent_work"] if r["type_key"] == "project"]
    assert proj_rows and "2 items" in proj_rows[0]["context"] and proj_rows[0]["status"] == "active"


def test_deliverables_list_and_get(conn):
    from lore import deliverables

    assert deliverables.list_deliverables(conn, "acme") == []
    conn.execute(
        """MERGE (d:Deliverable {id:'deliv:1'})
           SET d.company_id='acme', d.kind='faq', d.title='Travel FAQ', d.goal='FAQ about travel',
               d.content='# Travel FAQ', d.source_titles=['Booking Business Travel'], d.source_count=1,
               d.project_id='', d.created_by='alice', d.status='draft', d.created_at=$t""",
        {"t": datetime.now()},
    )
    conn.execute("MATCH (c:Company {id:'acme'}),(d:Deliverable {id:'deliv:1'}) MERGE (c)-[:HAS_DELIVERABLE]->(d)")
    lst = deliverables.list_deliverables(conn, "acme")
    assert len(lst) == 1 and lst[0]["status"] == "draft" and lst[0]["source_count"] == 1
    got = deliverables.get_deliverable(conn, "acme", "deliv:1")
    assert got["source_titles"] == ["Booking Business Travel"] and got["content"].startswith("# Travel FAQ")
    assert deliverables.get_deliverable(conn, "acme", "nope") is None

    # the draft shows up as "ready for review" in the workspace
    from lore import workspace
    home = workspace.workspace_home(conn, "acme", groups=["everyone"])
    assert any(w["status"] == "review" and w["title"] == "Travel FAQ" for w in home["active_work"])


def test_briefing_respects_acl_and_role(conn):
    from lore import briefing

    member = briefing.my_briefing(conn, "acme", "alice", "member", groups=["everyone"])
    titles = [c["title"] for c in member["recent_changes"]]
    assert "Booking Business Travel" in titles
    assert "Compensation Bands" not in titles          # HR-only doc filtered by ACL
    assert member["recent_changes"][0]["changed"] is True  # version 2 => flagged as updated
    assert "ops" not in member                          # members don't get the ops backlog
    assert member["name"] == "alice"                    # no User node -> falls back to username

    editor = briefing.my_briefing(conn, "acme", "hr_admin", "editor", groups=["hr", "everyone"])
    assert "ops" in editor and set(editor["ops"]) == {"gaps", "stale"}


def test_universal_search_lexical_and_people(conn):
    from lore import search

    res = search.universal_search(conn, "acme", "travel", groups=["everyone"])
    assert any(d["doc_id"] == "upload:travel" for d in res["documents"])
    # the matching doc's owner becomes a "person to ask"
    assert any(p["name"] == "HR Team" for p in res["people"])
    assert res["total"] >= 2

    # ACL: a public searcher never sees the HR-only doc even with a matching term
    res2 = search.universal_search(conn, "acme", "compensation", groups=["everyone"])
    assert not any(d["doc_id"] == "manual:comp" for d in res2["documents"])
    # ...but HR does
    res3 = search.universal_search(conn, "acme", "compensation", groups=["hr", "everyone"])
    assert any(d["doc_id"] == "manual:comp" for d in res3["documents"])
