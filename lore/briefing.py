"""Start-my-day briefing — a personal reason to open Lore first thing.

A lightweight, per-user snapshot (no LLM): the latest knowledge changes the person can see,
open questions across the company's projects, active projects, and — for editors — the
knowledge-ops backlog. Everything is a real, drillable count.
"""

from __future__ import annotations

from datetime import datetime

import kuzu

from lore.auth import can_see, role_at_least


def _name(conn: kuzu.Connection, company_id: str, username: str) -> str:
    res = conn.execute("MATCH (u:User {id:$id}) RETURN u.name", {"id": f"{company_id}:{username}"})
    if res.has_next():
        return (res.get_next()[0] or username).split()[0]
    return username or "there"


def my_briefing(conn: kuzu.Connection, company_id: str, username: str, role: str,
                groups: list[str] | None = None) -> dict:
    # Latest knowledge updates the user is allowed to see (most recently updated first).
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:OWNS]->(d:Document)
           RETURN d.id, d.title, d.version, d.updated_at, d.audience
           ORDER BY d.updated_at DESC""",
        {"cid": company_id},
    )
    changes = []
    while res.has_next():
        did, title, version, updated_at, aud = res.get_next()
        if not can_see(aud, groups):
            continue
        changes.append({
            "doc_id": did, "title": title, "version": int(version or 1),
            "updated_at": updated_at.isoformat() if updated_at else None,
            "changed": int(version or 1) > 1,
        })
        if len(changes) >= 5:
            break

    # Open questions across the company's projects.
    proj_names = {}
    pres = conn.execute(
        "MATCH (c:Company {id:$cid})-[:HAS_PROJECT]->(p:Project) RETURN p.id, p.name, p.created_at",
        {"cid": company_id},
    )
    proj_rows = []
    while pres.has_next():
        pid, name, created = pres.get_next()
        proj_names[pid] = name
        proj_rows.append((pid, name, created))

    open_questions = []
    counts: dict[str, int] = {}
    eres = conn.execute(
        "MATCH (p:Project)-[:HAS_ENTRY]->(e:ProjectEntry) RETURN e.kind, e.title, e.project_id", {},
    )
    while eres.has_next():
        kind, title, pid = eres.get_next()
        if pid not in proj_names:
            continue
        if kind == "question":
            counts[pid] = counts.get(pid, 0) + 1
            if len(open_questions) < 5:
                open_questions.append({"title": title, "project_id": pid, "project": proj_names[pid]})

    projects = sorted(
        ({"id": pid, "name": name, "open_questions": counts.get(pid, 0),
          "created_at": created.isoformat() if created else None} for pid, name, created in proj_rows),
        key=lambda p: (p["open_questions"], p["created_at"] or ""), reverse=True,
    )[:4]

    out = {
        "name": _name(conn, company_id, username), "role": role,
        "recent_changes": changes, "open_questions": open_questions, "projects": projects,
    }

    # Editors also get the knowledge-ops backlog (fast counts, no LLM).
    if role_at_least(role, "editor"):
        from lore.analytics import knowledge_gaps
        from lore.graph import queries
        out["ops"] = {
            "gaps": len(knowledge_gaps(conn, company_id, limit=1000)),
            "stale": len(queries.find_stale_docs(conn, company_id)),
        }
    return out
