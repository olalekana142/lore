"""Answer feedback — thumbs up/down, appended to a JSONL log next to the graph.

Kept deliberately simple (a flat log, not a graph node): it's write-mostly signal used
to spot bad answers and, later, to tune retrieval. Reads back aggregate counts.
"""

from __future__ import annotations

import json
from datetime import datetime

from lore.config import settings


def _path():
    settings.ensure_db_dir()
    return settings.db_path.parent / "feedback.jsonl"


def record(company_id: str, question: str, answer: str, rating: str, note: str = "") -> None:
    """Append one feedback row. rating is 'up' or 'down'."""
    row = {
        "company_id": company_id,
        "question": question,
        "answer": answer,
        "rating": "down" if rating == "down" else "up",
        "note": note,
        "ts": datetime.now().isoformat(),
    }
    with _path().open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def summary(company_id: str) -> dict:
    """Aggregate up/down counts for a company."""
    up = down = 0
    path = _path()
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("company_id") != company_id:
                continue
            if row.get("rating") == "down":
                down += 1
            else:
                up += 1
    return {"up": up, "down": down}
