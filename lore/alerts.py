"""Proactive knowledge alerts — make Lore an active operator, not a passive app.

Rather than wait for someone to open Content-Health, aggregate the signals Lore already
computes into one prioritised feed:

    🔴 critical  conflicting documents (contradictory facts still both live)
    🟠 review    past review date · missing owners · answers based on an outdated version
    🟡 gap       high-demand questions the knowledge base doesn't answer
    🟢 info      documents never used in an answer (candidate to retire/merge)

Every alert links to where it can be acted on. All counts are real, drillable numbers.
"""

from __future__ import annotations

import kuzu

_SEV_ORDER = {"critical": 0, "review": 1, "gap": 2, "info": 3}


def alerts(conn: kuzu.Connection, company_id: str, groups: list[str] | None = None) -> dict:
    from lore import analytics, health, provenance
    from lore.graph import queries

    out: list[dict] = []

    # 🔴 conflicts — contradictory facts across documents (the LLM-classified scan)
    conflicts = health.content_health(conn, company_id, groups=groups).get("conflicts", [])
    for c in conflicts[:5]:
        out.append({
            "severity": "critical", "kind": "conflict",
            "title": f"“{c['a']['title']}” conflicts with “{c['b']['title']}”",
            "detail": c.get("reason", "contradictory statements"), "href": "/health",
        })
    if len(conflicts) > 5:
        out.append({"severity": "critical", "kind": "conflict",
                    "title": f"{len(conflicts) - 5} more unresolved conflicts",
                    "detail": "Review and retire the losing side.", "href": "/health"})

    # 🟠 past review date
    stale = queries.find_stale_docs(conn, company_id)
    if stale:
        out.append({
            "severity": "review", "kind": "stale",
            "title": f"{len(stale)} document{'s' if len(stale) > 1 else ''} past the review date",
            "detail": ", ".join(d["title"] for d in stale[:3]) + ("…" if len(stale) > 3 else ""),
            "href": "/health",
        })

    # 🟠 missing owners
    docs = analytics.list_documents(conn, company_id, groups)
    unowned = [d for d in docs if not d.get("owner")]
    if unowned:
        out.append({
            "severity": "review", "kind": "ownership",
            "title": f"{len(unowned)} document{'s' if len(unowned) > 1 else ''} with no owner",
            "detail": "Assign an owner so someone is accountable for keeping it current.",
            "href": "/library",
        })

    # 🟠 answers based on an outdated version
    stale_ans = provenance.stale_answers(conn, company_id)
    if stale_ans:
        out.append({
            "severity": "review", "kind": "stale_answers",
            "title": f"{len(stale_ans)} past answer{'s' if len(stale_ans) > 1 else ''} based on an outdated version",
            "detail": "Re-evaluate them against the current documents.",
            "href": "/library",
        })

    # 🟡 high-demand gaps
    for g in analytics.knowledge_gaps(conn, company_id, limit=3):
        out.append({
            "severity": "gap", "kind": "gap",
            "title": f"“{g['question']}”",
            "detail": f"asked {g['asked_count']}× and not answered by the knowledge base",
            "href": "/gaps",
        })

    # 🟢 never-cited documents
    never = analytics.never_cited_docs(conn, company_id)
    if never:
        out.append({
            "severity": "info", "kind": "never_cited",
            "title": f"{len(never)} document{'s' if len(never) > 1 else ''} never used in an answer",
            "detail": "Candidates to merge, retire, or promote if they should be surfacing.",
            "href": "/health",
        })

    out.sort(key=lambda a: _SEV_ORDER.get(a["severity"], 9))
    counts = {s: sum(1 for a in out if a["severity"] == s) for s in _SEV_ORDER}
    return {"alerts": out, "counts": counts, "total": len(out)}
