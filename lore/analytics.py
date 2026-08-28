"""Analytics + knowledge-management queries over the graph.

- log_question:    record every asked question (clustered on write) for gaps & trends
- knowledge_gaps:  questions asked that the docs don't answer well (demand backlog)
- top_questions:   most-asked questions
- overview:        headline stats for the home dashboard
- list_documents / get_document: the document library
"""

from __future__ import annotations

import re
from datetime import datetime

import kuzu

from lore.graph.queries import find_stale_docs, topic_coverage
from lore.ingestion.embed import cosine

# Two asked questions this similar are treated as "the same question" and merged.
_MERGE_THRESHOLD = 0.85
# A question whose best supporting fact is below this is considered "not well covered".
_COVERAGE_THRESHOLD = 0.55


def _slug(text: str) -> str:
    return "q:" + re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def log_question(
    conn: kuzu.Connection,
    company_id: str,
    question: str,
    embedding: list[float],
    coverage: float,
    answered: bool,
) -> None:
    """Upsert an EmployeeQuestion, merging near-duplicates by embedding similarity.

    Increments asked_count (and unanswered_count when not answered), refreshes
    coverage/last_asked. `embedding` is reused from retrieval - no extra embed call.
    """
    res = conn.execute(
        "MATCH (c:Company {id:$cid})-[:ASKED]->(q:EmployeeQuestion) "
        "RETURN q.id, q.embedding",
        {"cid": company_id},
    )
    match_id = None
    best = _MERGE_THRESHOLD
    while res.has_next():
        qid, emb = res.get_next()
        if emb and cosine(embedding, emb) >= best:
            best, match_id = cosine(embedding, emb), qid

    now = datetime.now()
    if match_id:
        conn.execute(
            """MATCH (q:EmployeeQuestion {id:$id})
               SET q.asked_count = q.asked_count + 1,
                   q.unanswered_count = q.unanswered_count + $inc,
                   q.coverage = $cov, q.last_asked = $now""",
            {"id": match_id, "inc": 0 if answered else 1, "cov": coverage, "now": now},
        )
    else:
        qid = _slug(question)
        conn.execute(
            """MERGE (q:EmployeeQuestion {id:$id})
               SET q.text=$text, q.asked_count=1, q.unanswered_count=$inc,
                   q.coverage=$cov, q.last_asked=$now, q.embedding=$emb""",
            {"id": qid, "text": question, "inc": 0 if answered else 1,
             "cov": coverage, "now": now, "emb": embedding},
        )
        conn.execute(
            "MATCH (c:Company {id:$cid}), (q:EmployeeQuestion {id:$id}) "
            "MERGE (c)-[:ASKED]->(q)",
            {"cid": company_id, "id": qid},
        )


def knowledge_gaps(conn: kuzu.Connection, company_id: str, limit: int = 20) -> list[dict]:
    """Questions employees ask that the documents don't answer well - the gap backlog."""
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:ASKED]->(q:EmployeeQuestion)
           WHERE q.unanswered_count > 0 OR q.coverage < $cov
           RETURN q.text, q.asked_count, q.unanswered_count, q.coverage, q.last_asked
           ORDER BY q.unanswered_count DESC, q.asked_count DESC
           LIMIT $limit""",
        {"cid": company_id, "cov": _COVERAGE_THRESHOLD, "limit": limit},
    )
    return _rows(res, ["question", "asked_count", "unanswered_count", "coverage", "last_asked"])


def top_questions(conn: kuzu.Connection, company_id: str, limit: int = 10) -> list[dict]:
    """Most-asked questions overall."""
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:ASKED]->(q:EmployeeQuestion)
           RETURN q.text, q.asked_count, q.unanswered_count, q.coverage, q.last_asked
           ORDER BY q.asked_count DESC, q.last_asked DESC
           LIMIT $limit""",
        {"cid": company_id, "limit": limit},
    )
    return _rows(res, ["question", "asked_count", "unanswered_count", "coverage", "last_asked"])


def _scalar(conn: kuzu.Connection, cypher: str, cid: str) -> int:
    res = conn.execute(cypher, {"cid": cid})
    return int(res.get_next()[0]) if res.has_next() else 0


def overview(conn: kuzu.Connection, company_id: str) -> dict:
    """Headline stats + lists for the home dashboard."""
    docs = _scalar(conn, "MATCH (c:Company {id:$cid})-[:OWNS]->(d:Document) RETURN count(d)", company_id)
    facts = _scalar(
        conn,
        "MATCH (c:Company {id:$cid})-[:OWNS]->(:Document)-[:STATES]->(f:Fact) RETURN count(DISTINCT f)",
        company_id,
    )
    topics = _scalar(
        conn,
        "MATCH (c:Company {id:$cid})-[:OWNS]->(:Document)-[:ABOUT]->(t:Topic) RETURN count(DISTINCT t)",
        company_id,
    )
    questions = _scalar(
        conn,
        "MATCH (c:Company {id:$cid})-[:ASKED]->(q:EmployeeQuestion) RETURN coalesce(sum(q.asked_count),0)",
        company_id,
    )
    stale = find_stale_docs(conn, company_id)
    gaps = knowledge_gaps(conn, company_id, limit=100)
    return {
        "documents": docs,
        "facts": facts,
        "topics": topics,
        "questions_asked": questions,
        "stale_count": len(stale),
        "gaps_count": len(gaps),
        "top_topics": topic_coverage(conn, company_id, limit=6),
        "top_questions": top_questions(conn, company_id, limit=5),
        "top_gaps": gaps[:5],
        "stale_docs": stale[:5],
    }


def list_documents(conn: kuzu.Connection, company_id: str) -> list[dict]:
    """Every document with its fact count, topics, version and freshness."""
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:OWNS]->(d:Document)
           OPTIONAL MATCH (d)-[:STATES]->(f:Fact)
           OPTIONAL MATCH (d)-[:ABOUT]->(t:Topic)
           RETURN d.id, d.title, d.source, d.url, d.version, d.updated_at,
                  count(DISTINCT f) AS facts, collect(DISTINCT t.name) AS topics
           ORDER BY d.updated_at DESC""",
        {"cid": company_id},
    )
    out: list[dict] = []
    while res.has_next():
        did, title, source, url, version, updated_at, facts, topics = res.get_next()
        out.append(
            {
                "doc_id": did, "title": title, "source": source, "url": url or None,
                "version": version, "updated_at": updated_at.isoformat() if updated_at else None,
                "facts": facts, "topics": [t for t in topics if t],
            }
        )
    return out


def get_document(conn: kuzu.Connection, company_id: str, doc_id: str) -> dict | None:
    """Full document detail: text, extracted facts, topics, version, freshness."""
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:OWNS]->(d:Document {id:$did})
           RETURN d.title, d.source, d.url, d.text, d.version, d.updated_at""",
        {"cid": company_id, "did": doc_id},
    )
    if not res.has_next():
        return None
    title, source, url, text, version, updated_at = res.get_next()

    fres = conn.execute(
        "MATCH (d:Document {id:$did})-[:STATES]->(f:Fact) RETURN f.statement",
        {"did": doc_id},
    )
    facts = [row[0] for row in _iter(fres)]
    tres = conn.execute(
        "MATCH (d:Document {id:$did})-[:ABOUT]->(t:Topic) RETURN t.name",
        {"did": doc_id},
    )
    topics = [row[0] for row in _iter(tres)]
    return {
        "doc_id": doc_id, "title": title, "source": source, "url": url or None,
        "text": text, "version": version,
        "updated_at": updated_at.isoformat() if updated_at else None,
        "facts": facts, "topics": topics,
    }


# ---------------------------------------------------------------------- helpers
def _iter(result):
    while result.has_next():
        yield result.get_next()


def _rows(result, cols: list[str]) -> list[dict]:
    out: list[dict] = []
    for vals in _iter(result):
        row = {}
        for c, v in zip(cols, vals):
            row[c] = v.isoformat() if isinstance(v, datetime) else v
        out.append(row)
    return out
