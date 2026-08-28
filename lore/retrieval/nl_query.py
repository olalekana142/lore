"""Natural-language entry point for a worker's question.

For a company knowledge base the primary intent is always the same: answer the question
from the documents, with citations. So this is a thin wrapper over `answer.answer`.
(Future intents - "which docs are stale?", "what are people asking?" - can be routed
here as the surface grows.)
"""

from __future__ import annotations

import kuzu

from lore.retrieval.answer import answer


def ask(conn: kuzu.Connection, company_id: str, question: str) -> dict:
    """Answer a worker's natural-language question from the company's knowledge graph."""
    return answer(conn, company_id, question)
