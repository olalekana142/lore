"""Answer provenance & historical invalidation.

Every grounded answer is pinned to the KNOWLEDGE STATE it was based on: the documents it
cited and the version each was at. When a source later changes (a new version is ingested),
those pinned answers become potentially stale — Lore can surface exactly which past answers
a change invalidated, and re-answer them against fresh evidence.

    ask ──► record_answer (question + cited docs @ versions)
                     │
        document re-ingested → version bumps
                     │
    stale_answers / affected_answers  ──►  "based on an older version"  ──►  reanswer
"""

from __future__ import annotations

import uuid
from datetime import datetime

import kuzu


def record_answer(conn: kuzu.Connection, company_id: str, res: dict) -> str | None:
    """Persist a grounded answer with the version of every document it cited.

    No-op for ungrounded answers (nothing to invalidate). Returns the answer id.
    """
    sources = res.get("sources") or []
    if res.get("confidence") == "none" or not sources:
        return None
    aid = f"ans:{uuid.uuid4().hex[:12]}"
    docs = [s["doc_id"] for s in sources]
    versions = [int(s.get("version") or 1) for s in sources]
    conn.execute(
        """MERGE (a:Answer {id:$id})
           SET a.company_id=$cid, a.question=$q, a.answer=$ans, a.confidence=$conf,
               a.cited_docs=$docs, a.cited_versions=$vers, a.created_at=$ts,
               a.reanswered_at=NULL""",
        {"id": aid, "cid": company_id, "q": res["question"], "ans": res["answer"],
         "conf": res.get("confidence", "low"), "docs": docs, "vers": versions,
         "ts": datetime.now()},
    )
    conn.execute(
        "MATCH (c:Company {id:$cid}), (a:Answer {id:$id}) MERGE (c)-[:GENERATED]->(a)",
        {"cid": company_id, "id": aid},
    )
    return aid


def _current_versions(conn: kuzu.Connection, company_id: str) -> dict[str, int]:
    res = conn.execute(
        "MATCH (c:Company {id:$cid})-[:OWNS]->(d:Document) RETURN d.id, d.version",
        {"cid": company_id},
    )
    out: dict[str, int] = {}
    while res.has_next():
        did, ver = res.get_next()
        out[did] = int(ver or 1)
    return out


def _stale_docs(cited_docs, cited_versions, current: dict[str, int]) -> list[dict]:
    """Cited documents whose current version is newer than the one the answer used."""
    out = []
    for did, ver in zip(cited_docs or [], cited_versions or []):
        cur = current.get(did)
        if cur is not None and cur > int(ver):
            out.append({"doc_id": did, "answered_at_version": int(ver), "current_version": cur})
    return out


def stale_answers(conn: kuzu.Connection, company_id: str, doc_id: str | None = None) -> list[dict]:
    """Past answers whose evidence has since changed version (optionally for one document).

    Each item: the question, when it was answered, and which cited documents advanced
    (old → new version). These are the answers a knowledge change may have invalidated.
    """
    current = _current_versions(conn, company_id)
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:GENERATED]->(a:Answer)
           RETURN a.id, a.question, a.answer, a.confidence, a.cited_docs,
                  a.cited_versions, a.created_at, a.reanswered_at
           ORDER BY a.created_at DESC""",
        {"cid": company_id},
    )
    out = []
    while res.has_next():
        aid, q, ans, conf, docs, vers, created, reanswered = res.get_next()
        stale = _stale_docs(docs, vers, current)
        if doc_id is not None:
            stale = [s for s in stale if s["doc_id"] == doc_id]
        if not stale:
            continue
        out.append({
            "id": aid, "question": q, "answer": ans, "confidence": conf,
            "created_at": created.isoformat() if created else None,
            "reanswered_at": reanswered.isoformat() if reanswered else None,
            "stale_sources": stale,
        })
    return out


def stale_count(conn: kuzu.Connection, company_id: str, doc_id: str) -> int:
    return len(stale_answers(conn, company_id, doc_id))


def reanswer(conn: kuzu.Connection, company_id: str, answer_id: str,
             groups: list[str] | None = None) -> dict | None:
    """Re-run a stored answer against current evidence; update its pinned state; return
    the before/after so the UI can show what changed."""
    from lore.retrieval.answer import retrieve, synthesize

    res = conn.execute(
        "MATCH (a:Answer {id:$id, company_id:$cid}) RETURN a.question, a.answer",
        {"id": answer_id, "cid": company_id},
    )
    if not res.has_next():
        return None
    question, old_answer = res.get_next()

    fresh = synthesize(question, retrieve(conn, company_id, question, groups=groups))
    sources = fresh.get("sources") or []
    docs = [s["doc_id"] for s in sources]
    versions = [int(s.get("version") or 1) for s in sources]
    conn.execute(
        """MATCH (a:Answer {id:$id})
           SET a.answer=$ans, a.confidence=$conf, a.cited_docs=$docs,
               a.cited_versions=$vers, a.reanswered_at=$ts""",
        {"id": answer_id, "ans": fresh["answer"], "conf": fresh.get("confidence", "low"),
         "docs": docs, "vers": versions, "ts": datetime.now()},
    )
    return {
        "id": answer_id, "question": question,
        "old_answer": old_answer, "new_answer": fresh["answer"],
        "changed": old_answer.strip() != fresh["answer"].strip(),
        "sources": sources,
    }
