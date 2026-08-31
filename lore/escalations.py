"""Escalations — when Lore can't answer, forward the question to a human, then learn.

Flow: employee hits an undocumented question -> "Escalate to HR" -> the question lands in
an HR inbox -> HR writes the answer -> resolving it INGESTS that answer as a new document,
so the next person who asks gets it automatically. Closes the human-in-the-loop gap.

Stored as graph nodes (transactional; safe under concurrent create/resolve).
"""

from __future__ import annotations

import uuid
from datetime import datetime

import kuzu

from lore.ingestion.pipeline import ingest_text


def _row(vals) -> dict:
    qid, question, asked_by, status, answer, created_at, resolved_at = vals
    return {
        "id": qid, "question": question, "asked_by": asked_by, "status": status,
        "answer": answer, "created_at": created_at.isoformat() if created_at else None,
        "resolved_at": resolved_at.isoformat() if resolved_at else None,
    }


def create(conn: kuzu.Connection, company_id: str, question: str, asked_by: str = "") -> dict:
    # de-dupe: if the same open question already exists, return it
    for e in list_open(conn, company_id):
        if e["question"].strip().lower() == question.strip().lower():
            return e
    row = {
        "id": f"esc:{uuid.uuid4().hex}", "c": company_id, "q": question.strip(),
        "by": asked_by.strip(), "t": datetime.now(),
    }
    conn.execute(
        """CREATE (e:Escalation {id:$id, company_id:$c, question:$q, asked_by:$by,
                                 status:'open', answer:'', created_at:$t, resolved_at:NULL})""",
        row,
    )
    return {"id": row["id"], "company_id": company_id, "question": row["q"],
            "asked_by": row["by"], "status": "open", "answer": "",
            "created_at": row["t"].isoformat(), "resolved_at": None}


def list_open(conn: kuzu.Connection, company_id: str) -> list[dict]:
    res = conn.execute(
        """MATCH (e:Escalation {company_id:$c, status:'open'})
           RETURN e.id, e.question, e.asked_by, e.status, e.answer, e.created_at, e.resolved_at
           ORDER BY e.created_at DESC""",
        {"c": company_id},
    )
    out = []
    while res.has_next():
        row = _row(res.get_next())
        row["company_id"] = company_id
        out.append(row)
    return out


def resolve(conn: kuzu.Connection, company_id: str, escalation_id: str, answer: str) -> dict:
    """Save HR's answer as a knowledge-base document and close the escalation."""
    res = conn.execute(
        "MATCH (e:Escalation {id:$id, company_id:$c}) RETURN e.question",
        {"id": escalation_id, "c": company_id},
    )
    if not res.has_next():
        raise ValueError("escalation not found")
    question = res.get_next()[0]

    summary = ingest_text(company_id, f"Q&A: {question}", answer)
    conn.execute(
        "MATCH (e:Escalation {id:$id}) SET e.status='resolved', e.answer=$a, e.resolved_at=$t",
        {"id": escalation_id, "a": answer, "t": datetime.now()},
    )
    return {"resolved": {"id": escalation_id, "question": question, "answer": answer},
            "ingest": summary}
