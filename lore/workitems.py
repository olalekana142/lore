"""Work items — the stateful layer that makes the dashboard actionable.

The workspace derives signals (a draft to review, a project with open questions, a recurring
unanswered question). Those are MATERIALIZED here into WorkItem records keyed by a stable
source_ref, so a person can assign an owner and move an item to done — and a resolved item
stays resolved instead of re-appearing on the next refresh.

    status: progress | review | owner | done
"""

from __future__ import annotations

import hashlib
from datetime import datetime

import kuzu

STATUS_LABEL = {"progress": "In progress", "review": "Ready for review", "owner": "Needs owner", "done": "Done"}
_DEFAULT_STATUS = {"deliverable": "review", "project": "progress", "gap": "owner"}
_VALID = set(STATUS_LABEL)


def _wid(company_id: str, source_ref: str) -> str:
    return "wi:" + hashlib.sha1(f"{company_id}|{source_ref}".encode()).hexdigest()[:12]


def materialize(conn: kuzu.Connection, company_id: str, signals: list[dict]) -> None:
    """Upsert derived signals as work items. Existing items keep their status/owner (so 'done'
    stays done); only the descriptive fields are refreshed."""
    now = datetime.now()
    for s in signals:
        wid = _wid(company_id, s["source_ref"])
        conn.execute(
            """MERGE (w:WorkItem {id:$id})
               ON CREATE SET w.status=$status, w.owner='', w.created_at=$ts
               SET w.company_id=$cid, w.source_ref=$ref, w.kind=$kind, w.title=$title,
                   w.detail=$detail, w.context=$context, w.tag=$tag, w.href=$href, w.updated_at=$ts""",
            {"id": wid, "status": _DEFAULT_STATUS.get(s["kind"], "progress"), "ts": now,
             "cid": company_id, "ref": s["source_ref"], "kind": s["kind"], "title": s["title"],
             "detail": s.get("detail", ""), "context": s.get("context", ""), "tag": s.get("tag", ""),
             "href": s.get("href", "/workspace")},
        )
        conn.execute(
            "MATCH (c:Company {id:$cid}), (w:WorkItem {id:$id}) MERGE (c)-[:HAS_WORKITEM]->(w)",
            {"cid": company_id, "id": wid},
        )


def list_workitems(conn: kuzu.Connection, company_id: str, include_done: bool = False) -> list[dict]:
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:HAS_WORKITEM]->(w:WorkItem)
           RETURN w.id, w.source_ref, w.kind, w.title, w.detail, w.context, w.tag, w.href,
                  w.status, w.owner, w.created_at, w.updated_at
           ORDER BY w.updated_at DESC""",
        {"cid": company_id},
    )
    out = []
    while res.has_next():
        wid, ref, kind, title, detail, context, tag, href, status, owner, created, updated = res.get_next()
        if status == "done" and not include_done:
            continue
        out.append({
            "id": wid, "source_ref": ref, "kind": kind, "title": title, "desc": detail or "",
            "context": context or "", "tag": tag or "", "href": href or "/workspace",
            "status": status, "status_label": STATUS_LABEL.get(status, status), "owner": owner or "",
            "created_at": created.isoformat() if created else None,
            "updated": updated.isoformat() if updated else None,
        })
    return out


def update_workitem(conn: kuzu.Connection, company_id: str, item_id: str,
                    status: str | None = None, owner: str | None = None) -> dict | None:
    res = conn.execute(
        "MATCH (c:Company {id:$cid})-[:HAS_WORKITEM]->(w:WorkItem {id:$id}) RETURN w.status, w.owner",
        {"cid": company_id, "id": item_id},
    )
    if not res.has_next():
        return None
    cur_status, cur_owner = res.get_next()
    new_owner = owner if owner is not None else (cur_owner or "")
    new_status = status if status in _VALID else cur_status
    # assigning an owner to a 'needs owner' item naturally moves it into progress
    if owner and cur_status == "owner" and status is None:
        new_status = "progress"
    conn.execute(
        "MATCH (w:WorkItem {id:$id}) SET w.status=$st, w.owner=$own, w.updated_at=$ts",
        {"id": item_id, "st": new_status, "own": new_owner, "ts": datetime.now()},
    )
    return next((w for w in list_workitems(conn, company_id, include_done=True) if w["id"] == item_id), None)
