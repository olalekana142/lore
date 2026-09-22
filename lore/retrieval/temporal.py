"""Temporal query understanding — resolve the point in time a question asks about.

Company policies change. "What is the PTO policy?" wants the CURRENT one; "what was it in
2025?" or "before the 2026 change?" wants the historical one. We resolve an `as_of` date
from the question, then retrieval only considers documents whose effective window covers it
(and, for current questions, demotes superseded documents).
"""

from __future__ import annotations

import re
from datetime import datetime


def parse_as_of(question: str) -> datetime | None:
    """Return the date a question is asking about, or None meaning 'current/now'."""
    q = question.lower()

    # "before the 2026 change", "prior to 2026", "before 2026" -> just before that year
    m = re.search(r"(?:before|prior to|preceding)\s+(?:the\s+)?(?:\w+\s+)?(19|20)\d{2}", q)
    if m:
        year = int(re.search(r"(19|20)\d{2}", m.group(0)).group(0))
        return datetime(year - 1, 12, 31)

    # explicit year: "in 2025", "the 2024 policy"
    m = re.search(r"\b(19|20)\d{2}\b", q)
    if m:
        return datetime(int(m.group(0)), 6, 30)

    # historical cue words without a year -> can't pin a date; fall back to current
    return None


def effective_at(effective_from, effective_to, at: datetime) -> bool:
    """Is a document with this effective window in force at `at`?"""
    if effective_from and at < effective_from:
        return False
    if effective_to and at > effective_to:
        return False
    return True


def is_superseded(effective_to, now: datetime) -> bool:
    return bool(effective_to and effective_to < now)
