"""Workspace home — the 'work gets done' dashboard.

Assembles a single, real-data view for the Workspace landing (no LLM, fast):
  - active_work:     what to pick up — drafts to review, recurring questions needing an owner,
                     projects with open items in progress.
  - company_signals: what changed — latest document update, a trending repeated question, the
                     newest recorded decision.
  - recent_work:     finished/ongoing artifacts — generated deliverables + project memory.
Every item is a real, drillable record with a direct next action (href).
"""

from __future__ import annotations

from datetime import datetime

import kuzu

from lore.auth import can_see


def _open_question_counts(conn: kuzu.Connection, project_ids: set[str]) -> dict[str, int]:
    if not project_ids:
        return {}
    res = conn.execute(
        "MATCH (p:Project)-[:HAS_ENTRY]->(e:ProjectEntry {kind:'question'}) RETURN e.project_id", {},
    )
    counts: dict[str, int] = {}
    while res.has_next():
        pid = res.get_next()[0]
        if pid in project_ids:
            counts[pid] = counts.get(pid, 0) + 1
    return counts


def workspace_home(conn: kuzu.Connection, company_id: str, groups: list[str] | None = None) -> dict:
    from lore import analytics, deliverables
    from lore import projects as projmod

    delivs = deliverables.list_deliverables(conn, company_id, limit=12)
    projs = projmod.list_projects(conn, company_id)
    open_q = _open_question_counts(conn, {p["id"] for p in projs})
    gaps = analytics.knowledge_gaps(conn, company_id, limit=10)
    recurring = [g for g in gaps if int(g.get("asked_count") or 0) >= 2]

    # ---- active work (pick up where you left off) ----
    # Derive signals, then MATERIALIZE them as stateful WorkItems (keyed by source_ref) so a
    # person can assign an owner / mark done and the dashboard remembers it.
    from lore import workitems

    signals: list[dict] = []
    for d in delivs:
        if d["status"] == "draft":
            signals.append({
                "source_ref": f"deliverable:{d['id']}", "kind": "deliverable", "title": d["title"],
                "detail": f"{d['kind'].upper()} drafted from company knowledge — review before it goes out.",
                "context": f"{d['source_count']} source{'s' if d['source_count'] != 1 else ''}",
                "tag": d["kind"], "href": "/workspace#recent",
            })
    for p in sorted(projs, key=lambda x: open_q.get(x["id"], 0), reverse=True):
        oq = open_q.get(p["id"], 0)
        if oq > 0:
            signals.append({
                "source_ref": f"project:{p['id']}", "kind": "project", "title": p["name"],
                "detail": "Open questions and decisions in this project's memory.",
                "context": f"{oq} open question{'s' if oq != 1 else ''}",
                "tag": "project", "href": f"/projects/{p['id']}",
            })
    for g in recurring[:3]:
        signals.append({
            "source_ref": f"gap:{g['question']}", "kind": "gap",
            "title": f"Resolve repeated question: {g['question'][:60]}",
            "detail": "Create or update documentation for this recurring question.",
            "context": f"asked {int(g['asked_count'])}×", "tag": g.get("topic") or "gap", "href": "/gaps",
        })
    workitems.materialize(conn, company_id, signals)
    # keep the list MIXED: at most 3 per kind so a pile of drafts can't hide a project or a
    # recurring question that needs an owner
    per_kind: dict[str, int] = {}
    active = []
    for w in workitems.list_workitems(conn, company_id):
        if per_kind.get(w["kind"], 0) >= 3:
            continue
        per_kind[w["kind"]] = per_kind.get(w["kind"], 0) + 1
        active.append(w)
        if len(active) >= 7:
            break

    # ---- company signals ----
    signals: list[dict] = []
    res = conn.execute(
        "MATCH (c:Company {id:$cid})-[:OWNS]->(d:Document) RETURN d.title, d.version, d.updated_at, d.audience ORDER BY d.updated_at DESC",
        {"cid": company_id},
    )
    while res.has_next():
        title, version, updated_at, aud = res.get_next()
        if can_see(aud, groups) and int(version or 1) > 1:
            signals.append({"icon": "doc", "title": f"{title} updated",
                            "detail": "Answers from this document may need review",
                            "href": "/library", "when": _iso(updated_at)})
            break
    if recurring:
        g = recurring[0]
        signals.append({"icon": "people", "title": f"{int(g['asked_count'])} employees asked about {g.get('topic') or 'this topic'}",
                        "detail": "Trending — no authoritative answer yet", "href": "/gaps", "when": _iso(g.get("last_asked"))})
    dres = conn.execute(
        """MATCH (c:Company {id:$cid})-[:HAS_PROJECT]->(p:Project)-[:HAS_ENTRY]->(e:ProjectEntry {kind:'decision'})
           RETURN e.title, p.name, e.created_at ORDER BY e.created_at DESC""", {"cid": company_id},
    )
    if dres.has_next():
        dt, pname, created = dres.get_next()
        signals.append({"icon": "decision", "title": f"Decision recorded: {dt[:50]}",
                        "detail": f"Available in {pname} memory", "href": "/projects", "when": _iso(created)})

    # ---- recent work ----
    recent: list[dict] = []
    for d in delivs:
        is_meeting = d["kind"] == "meeting"
        recent.append({
            "id": d["id"], "title": d["title"],
            "type": "Meeting" if is_meeting else "Generated", "type_key": "meeting" if is_meeting else "generated",
            "context": (f"checked against {d['source_count']} source{'s' if d['source_count'] != 1 else ''}" if is_meeting
                        else f"{d['source_count']} source{'s' if d['source_count'] != 1 else ''}"),
            "status": "review" if d["status"] in ("draft", "review") else "done",
            "status_label": ("Policy conflicts — review" if is_meeting and d["status"] == "review"
                             else "Draft — review before sharing" if d["status"] == "draft" else "Complete"),
            "grounded": d["source_count"] > 0, "source_count": d["source_count"],
            "updated": d["created_at"], "href": "/workspace#recent",
        })
    for p in projs:
        recent.append({
            "id": p["id"], "title": f"Project memory — {p['name']}", "type": "Project memory", "type_key": "project",
            "context": f"{p['entries']} item{'s' if p['entries'] != 1 else ''}"
                       + (f" · {p.get('people', 0)} people" if p.get("people") else "")
                       + (f" · {p.get('docs', 0)} docs" if p.get("docs") else "")
                       + (f" · {open_q.get(p['id'], 0)} open" if open_q.get(p["id"], 0) else ""),
            "status": "active", "status_label": "Active", "grounded": False, "source_count": 0,
            "updated": p["created_at"], "href": f"/projects/{p['id']}",
        })
    # keep recent work MIXED too: newest 4 generated + newest 3 projects, then by recency
    recent.sort(key=lambda x: x["updated"] or "", reverse=True)
    gen = [r for r in recent if r["type_key"] in ("generated", "meeting")][:4]
    proj = [r for r in recent if r["type_key"] == "project"][:3]
    recent = sorted(gen + proj, key=lambda x: x["updated"] or "", reverse=True)

    return {"active_work": active, "company_signals": signals[:3], "recent_work": recent}


def _iso(v) -> str | None:
    if v is None:
        return None
    return v.isoformat() if isinstance(v, datetime) else str(v)
