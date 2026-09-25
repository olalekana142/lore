"""Lore Autopilot — proactive attention digest.

A ranked "here are N things worth your attention" brief that turns the signals across the
graph into concrete, actionable findings — including two the passive alert feed doesn't call
out: a document that appears to SUPERSEDE another (with a one-click retire), and questions a
team keeps asking that still aren't answered. Every item links to where it's handled.
"""

from __future__ import annotations

import kuzu

_ORDER = {"critical": 0, "review": 1, "gap": 2, "info": 3}


def autopilot(conn: kuzu.Connection, company_id: str, groups: list[str] | None = None) -> dict:
    from lore import analytics, health, provenance
    from lore.graph import queries

    items: list[dict] = []

    # Conflicts — framed as supersede suggestions when one side clearly wins. Dedupe by the
    # document pair (the scan can surface several fact-level conflicts between the same docs).
    ch = health.content_health(conn, company_id, groups=groups)
    seen_pairs: set[frozenset[str]] = set()
    for c in ch.get("conflicts", []):
        pair = frozenset({c["a"]["doc_id"], c["b"]["doc_id"]})
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        rec = c.get("recommend") or {}
        sides = {c["a"]["doc_id"]: c["a"], c["b"]["doc_id"]: c["b"]}
        winner, loser = sides.get(rec.get("winner_doc")), sides.get(rec.get("loser_doc"))
        if winner and loser and not loser.get("superseded"):
            items.append({
                "severity": "critical", "kind": "supersede",
                "title": f"“{winner['title']}” appears to supersede “{loser['title']}”",
                "detail": c.get("reason", "") or "They give conflicting answers.",
                "href": "/health",
                "action": {"type": "supersede", "doc_id": loser["doc_id"], "title": loser["title"]},
            })
        else:
            items.append({
                "severity": "critical", "kind": "conflict",
                "title": f"“{c['a']['title']}” conflicts with “{c['b']['title']}”",
                "detail": c.get("reason", ""), "href": "/health",
            })

    # Recurring, still-unanswered questions (a team keeps asking).
    for g in analytics.knowledge_gaps(conn, company_id, limit=5):
        asked = int(g.get("asked_count") or 0)
        if asked >= 2:
            items.append({
                "severity": "gap", "kind": "recurring_gap",
                "title": f"“{g['question']}”",
                "detail": f"asked {asked}× and still not answered by the knowledge base",
                "href": f"/gaps",
            })

    # Overdue reviews.
    stale = queries.find_stale_docs(conn, company_id)
    if stale:
        items.append({"severity": "review", "kind": "stale",
                      "title": f"{len(stale)} document{'s' if len(stale) > 1 else ''} overdue for review",
                      "detail": ", ".join(d["title"] for d in stale[:3]) + ("…" if len(stale) > 3 else ""),
                      "href": "/health"})

    # Past answers based on an outdated version.
    sa = provenance.stale_answers(conn, company_id)
    if sa:
        items.append({"severity": "review", "kind": "stale_answer",
                      "title": f"{len(sa)} past answer{'s' if len(sa) > 1 else ''} based on an outdated version",
                      "detail": "Re-answer them against the current documents.", "href": "/library"})

    # Ownership gaps.
    docs = analytics.list_documents(conn, company_id, groups)
    unowned = [d for d in docs if not d.get("owner")]
    if unowned:
        items.append({"severity": "review", "kind": "ownership",
                      "title": f"{len(unowned)} document{'s' if len(unowned) > 1 else ''} with no owner",
                      "detail": "Assign an owner so someone is accountable for keeping it current.",
                      "href": "/library"})

    # Unused knowledge.
    never = analytics.never_cited_docs(conn, company_id)
    if never:
        items.append({"severity": "info", "kind": "never_cited",
                      "title": f"{len(never)} document{'s' if len(never) > 1 else ''} never used in an answer",
                      "detail": "Candidates to merge, retire, or promote.", "href": "/health"})

    items.sort(key=lambda x: _ORDER.get(x["severity"], 9))
    n = len(items)
    headline = "You're all caught up — nothing needs attention." if n == 0 \
        else f"I found {n} thing{'s' if n != 1 else ''} worth your attention."
    counts = {s: sum(1 for i in items if i["severity"] == s) for s in _ORDER}
    return {"headline": headline, "count": n, "items": items, "counts": counts}
