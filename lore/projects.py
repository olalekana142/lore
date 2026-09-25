"""Project memory — durable organizational memory beyond documents.

A Project accumulates the decisions, action items, open questions and notes that pile up over
a piece of work (often straight from meeting analyses). Because it's all in the graph, the
project's own history becomes queryable:

    "Why did we choose PostgreSQL?"      -> answered from the project's decisions
    "What's still unresolved?"           -> its open questions
    "Summarize what changed this week."  -> its recent entries

Project Q&A blends the project's memory with the company knowledge base, so answers stay
grounded in both what the team decided and what the official policies say.
"""

from __future__ import annotations

import uuid
from datetime import datetime

import kuzu

from lore.config import settings
from lore.llm import complete

KINDS = {"decision", "action", "question", "note"}


def create_project(conn: kuzu.Connection, company_id: str, name: str, description: str = "") -> dict:
    pid = f"proj:{uuid.uuid4().hex[:10]}"
    conn.execute(
        "MERGE (p:Project {id:$id}) SET p.company_id=$cid, p.name=$n, p.description=$d, p.created_at=$ts",
        {"id": pid, "cid": company_id, "n": name.strip() or "Untitled project", "d": description.strip(), "ts": datetime.now()},
    )
    conn.execute(
        "MATCH (c:Company {id:$cid}), (p:Project {id:$id}) MERGE (c)-[:HAS_PROJECT]->(p)",
        {"cid": company_id, "id": pid},
    )
    return {"id": pid, "name": name.strip() or "Untitled project", "description": description.strip()}


def list_projects(conn: kuzu.Connection, company_id: str) -> list[dict]:
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:HAS_PROJECT]->(p:Project)
           OPTIONAL MATCH (p)-[:HAS_ENTRY]->(e:ProjectEntry)
           RETURN p.id, p.name, p.description, p.created_at, count(e)
           ORDER BY p.created_at DESC""",
        {"cid": company_id},
    )
    out = []
    while res.has_next():
        pid, name, desc, created, n = res.get_next()
        out.append({"id": pid, "name": name, "description": desc or "",
                    "created_at": created.isoformat() if created else None, "entries": int(n or 0)})
    return out


def _entries(conn: kuzu.Connection, project_id: str) -> list[dict]:
    res = conn.execute(
        """MATCH (:Project {id:$id})-[:HAS_ENTRY]->(e:ProjectEntry)
           RETURN e.id, e.kind, e.title, e.body, e.owner, e.due, e.created_at
           ORDER BY e.created_at DESC""",
        {"id": project_id},
    )
    out = []
    while res.has_next():
        eid, kind, title, body, owner, due, created = res.get_next()
        out.append({"id": eid, "kind": kind, "title": title, "body": body or "",
                    "owner": owner or "", "due": due or "",
                    "created_at": created.isoformat() if created else None})
    return out


def get_project(conn: kuzu.Connection, company_id: str, project_id: str) -> dict | None:
    res = conn.execute(
        "MATCH (c:Company {id:$cid})-[:HAS_PROJECT]->(p:Project {id:$id}) RETURN p.name, p.description, p.created_at",
        {"cid": company_id, "id": project_id},
    )
    if not res.has_next():
        return None
    name, desc, created = res.get_next()
    entries = _entries(conn, project_id)
    counts = {k: sum(1 for e in entries if e["kind"] == k) for k in KINDS}
    return {"id": project_id, "name": name, "description": desc or "",
            "created_at": created.isoformat() if created else None,
            "entries": entries, "counts": counts}


def add_entries(conn: kuzu.Connection, company_id: str, project_id: str, entries: list[dict]) -> int:
    """Append entries (decision/action/question/note) to a project. Returns count added."""
    res = conn.execute(
        "MATCH (c:Company {id:$cid})-[:HAS_PROJECT]->(p:Project {id:$id}) RETURN p.id",
        {"cid": company_id, "id": project_id},
    )
    if not res.has_next():
        return 0
    added = 0
    for e in entries:
        title = (e.get("title") or "").strip()
        if not title:
            continue
        kind = e.get("kind") if e.get("kind") in KINDS else "note"
        eid = f"pe:{uuid.uuid4().hex[:10]}"
        conn.execute(
            """MERGE (e:ProjectEntry {id:$id})
               SET e.project_id=$pid, e.kind=$kind, e.title=$title, e.body=$body,
                   e.owner=$owner, e.due=$due, e.created_at=$ts""",
            {"id": eid, "pid": project_id, "kind": kind, "title": title,
             "body": (e.get("body") or "").strip(), "owner": (e.get("owner") or "").strip(),
             "due": (e.get("due") or "").strip(), "ts": datetime.now()},
        )
        conn.execute(
            "MATCH (p:Project {id:$pid}), (e:ProjectEntry {id:$id}) MERGE (p)-[:HAS_ENTRY]->(e)",
            {"pid": project_id, "id": eid},
        )
        added += 1
    return added


_ASK_PROMPT = """Answer the question using the PROJECT MEMORY and COMPANY POLICY below.
Prefer the project's own decisions/notes for "why/what did we decide" questions. Cite the
basis inline as (decision), (note), (question) or (policy: <doc title>). If neither contains
the answer, say it isn't recorded in this project yet. Be concise.

PROJECT MEMORY:
{memory}

COMPANY POLICY (for grounding):
{policy}

QUESTION: {question}
"""


def ask_project(conn: kuzu.Connection, company_id: str, project_id: str, question: str,
                groups: list[str] | None = None) -> dict | None:
    """Answer from the project's memory, grounded also in the company knowledge base."""
    from lore.retrieval.answer import retrieve

    proj = get_project(conn, company_id, project_id)
    if proj is None:
        return None
    memory = "\n".join(f"- ({e['kind']}) {e['title']}" + (f" — {e['body']}" if e['body'] else "")
                       for e in proj["entries"]) or "(no entries yet)"
    r = retrieve(conn, company_id, question, groups=groups)
    policy = "\n".join(f'- "{f["statement"]}" (doc: {f["title"]})' for f in r["facts"][:6]) or "(none relevant)"
    answer = complete(
        _ASK_PROMPT.format(memory=memory[:6000], policy=policy, question=question),
        model=settings.generation_model, max_tokens=500, temperature=0.2,
    )
    return {"project_id": project_id, "question": question, "answer": answer.strip(),
            "sources": r["sources"]}
