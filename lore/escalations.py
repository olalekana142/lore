"""Escalations — when Lore can't answer, forward the question to a human, then learn.

Flow: employee hits an undocumented question -> "Escalate to HR" -> the question lands in
an HR inbox -> HR writes the answer -> resolving it INGESTS that answer as a new document,
so the next person who asks gets it automatically. Closes the human-in-the-loop gap.

Stored as a JSONL log next to the graph (write-mostly, small).
"""

from __future__ import annotations

import json
import threading
from datetime import datetime

from lore.config import settings
from lore.ingestion.pipeline import ingest_text

# Serialize the read-modify-write cycle so concurrent create/resolve calls can't clobber
# each other's changes to the JSONL log.
_lock = threading.Lock()


def _path():
    settings.ensure_db_dir()
    return settings.db_path.parent / "escalations.jsonl"


def _read_all() -> list[dict]:
    path = _path()
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def _write_all(rows: list[dict]) -> None:
    with _path().open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def create(company_id: str, question: str, asked_by: str = "") -> dict:
    with _lock:
        rows = _read_all()
        # de-dupe: if the same open question already exists, just return it
        for r in rows:
            if r["company_id"] == company_id and r["status"] == "open" and \
                    r["question"].strip().lower() == question.strip().lower():
                return r
        row = {
            "id": f"esc-{len(rows) + 1}-{int(datetime.now().timestamp())}",
            "company_id": company_id,
            "question": question.strip(),
            "asked_by": asked_by.strip(),
            "status": "open",
            "answer": "",
            "created_at": datetime.now().isoformat(),
            "resolved_at": None,
        }
        rows.append(row)
        _write_all(rows)
        return row


def list_open(company_id: str) -> list[dict]:
    return [r for r in _read_all() if r["company_id"] == company_id and r["status"] == "open"]


def resolve(company_id: str, escalation_id: str, answer: str) -> dict:
    """Save HR's answer as a knowledge-base document and close the escalation."""
    with _lock:
        rows = _read_all()
        target = next(
            (r for r in rows if r["id"] == escalation_id and r["company_id"] == company_id), None
        )
        if target is None:
            raise ValueError("escalation not found")
        summary = ingest_text(company_id, f"Q&A: {target['question']}", answer)
        target["status"] = "resolved"
        target["answer"] = answer
        target["resolved_at"] = datetime.now().isoformat()
        _write_all(rows)
        return {"resolved": target, "ingest": summary}
