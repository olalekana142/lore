"""Graph query helpers - the relational logic that makes Lore more than flat vector RAG.

Backs the maintenance/insight tools (stale-doc review, topic coverage). Each is a graph
traversal that plain embedding search can't express.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import kuzu


def find_stale_docs(
    conn: kuzu.Connection,
    company_id: str,
    stale_after_days: int = 180,
    limit: int = 20,
) -> list[dict]:
    """Documents not updated in `stale_after_days` - the review backlog.

    Traversal: Company -> OWNS -> Document, filtered to those whose `updated_at` is older
    than the cutoff, ordered oldest-first. Powers the "when it's updated" hygiene loop:
    surface what's gone stale so someone re-ingests the current version.
    """
    cutoff = datetime.now() - timedelta(days=stale_after_days)
    query = """
        MATCH (c:Company {id: $cid})-[:OWNS]->(d:Document)
        WHERE d.updated_at < $cutoff
        RETURN d.id AS doc_id, d.title AS title, d.url AS url,
               d.version AS version, d.updated_at AS updated_at
        ORDER BY d.updated_at ASC
        LIMIT $limit
    """
    return _rows(conn.execute(query, {"cid": company_id, "cutoff": cutoff, "limit": limit}))


def topic_coverage(conn: kuzu.Connection, company_id: str, limit: int = 30) -> list[dict]:
    """How many documents cover each topic - spot thin/undocumented areas."""
    query = """
        MATCH (c:Company {id: $cid})-[:OWNS]->(d:Document)-[:ABOUT]->(t:Topic)
        RETURN t.name AS topic, count(DISTINCT d) AS documents
        ORDER BY documents DESC
        LIMIT $limit
    """
    return _rows(conn.execute(query, {"cid": company_id, "limit": limit}))


def _rows(result) -> list[dict]:
    """Normalize a Kuzu QueryResult into a list of dicts (timestamps -> ISO strings)."""
    cols = result.get_column_names()
    out: list[dict] = []
    while result.has_next():
        row = {}
        for col, val in zip(cols, result.get_next()):
            row[col] = val.isoformat() if isinstance(val, datetime) else val
        out.append(row)
    return out
