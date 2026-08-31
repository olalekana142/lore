"""Analytics + knowledge-management queries over the graph.

- log_question:    record every asked question (clustered on write) for gaps & trends
- knowledge_gaps:  questions asked that the docs don't answer well (demand backlog)
- top_questions:   most-asked questions
- overview:        headline stats for the home dashboard
- list_documents / get_document: the document library
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta

import kuzu

from lore.auth import can_see
from lore.config import settings
from lore.graph.queries import find_stale_docs, topic_coverage
from lore.ingestion.embed import cosine
from lore.llm import complete

# Rough value heuristic: each self-served (answered) question saves this many minutes
# versus pinging a colleague / searching. Used only for the "time saved" ROI tile.
_MINUTES_PER_ANSWER = 5

# Two asked questions this similar are treated as "the same question" and merged.
_MERGE_THRESHOLD = 0.85
# A question whose best supporting fact is below this is considered "not well covered".
_COVERAGE_THRESHOLD = 0.55


def _slug(text: str) -> str:
    return "q:" + re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def primary_topic(conn: kuzu.Connection, doc_id: str) -> str:
    """The first topic a document is tagged with (used to categorize questions)."""
    res = conn.execute(
        "MATCH (d:Document {id:$id})-[:ABOUT]->(t:Topic) RETURN t.name LIMIT 1",
        {"id": doc_id},
    )
    return res.get_next()[0] if res.has_next() else "General"


def log_question(
    conn: kuzu.Connection,
    company_id: str,
    question: str,
    embedding: list[float],
    coverage: float,
    answered: bool,
    topic: str = "",
) -> None:
    """Upsert an EmployeeQuestion, merging near-duplicates by embedding similarity.

    Increments asked_count (and unanswered_count when not answered), refreshes
    coverage/last_asked/topic. `embedding` is reused from retrieval - no extra embed call.
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
                   q.coverage = $cov, q.topic = $topic, q.last_asked = $now""",
            {"id": match_id, "inc": 0 if answered else 1, "cov": coverage,
             "topic": topic or "General", "now": now},
        )
    else:
        qid = _slug(question)
        conn.execute(
            """MERGE (q:EmployeeQuestion {id:$id})
               SET q.text=$text, q.asked_count=1, q.unanswered_count=$inc,
                   q.coverage=$cov, q.topic=$topic, q.last_asked=$now, q.embedding=$emb""",
            {"id": qid, "text": question, "inc": 0 if answered else 1,
             "cov": coverage, "topic": topic or "General", "now": now, "emb": embedding},
        )
        conn.execute(
            "MATCH (c:Company {id:$cid}), (q:EmployeeQuestion {id:$id}) "
            "MERGE (c)-[:ASKED]->(q)",
            {"cid": company_id, "id": qid},
        )


def questions_by_topic(conn: kuzu.Connection, company_id: str) -> list[dict]:
    """Share of questions asked, broken down by topic (the leadership blind-spot view)."""
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:ASKED]->(q:EmployeeQuestion)
           RETURN coalesce(q.topic,'General') AS topic, sum(q.asked_count) AS n
           ORDER BY n DESC""",
        {"cid": company_id},
    )
    rows = [{"topic": t, "count": int(n)} for t, n in _iter(res)]
    total = sum(r["count"] for r in rows) or 1
    for r in rows:
        r["pct"] = round(100 * r["count"] / total)
    return rows


def verify_document(conn: kuzu.Connection, doc_id: str, owner: str) -> None:
    """Mark a document reviewed/verified now, with an owner."""
    conn.execute(
        "MATCH (d:Document {id:$id}) SET d.owner=$owner, d.verified_at=$now",
        {"id": doc_id, "owner": owner.strip(), "now": datetime.now()},
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


def record_citations(conn: kuzu.Connection, doc_ids: list[str]) -> None:
    """Bump cited_count/last_cited for each document an answer actually cited (ROI signal)."""
    now = datetime.now()
    for did in doc_ids:
        conn.execute(
            """MATCH (d:Document {id:$id})
               SET d.cited_count = coalesce(d.cited_count, 0) + 1, d.last_cited = $now""",
            {"id": did, "now": now},
        )


def most_cited_docs(conn: kuzu.Connection, company_id: str, limit: int = 5) -> list[dict]:
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:OWNS]->(d:Document)
           WHERE coalesce(d.cited_count, 0) > 0
           RETURN d.id, d.title, d.cited_count
           ORDER BY d.cited_count DESC LIMIT $limit""",
        {"cid": company_id, "limit": limit},
    )
    return [{"doc_id": r[0], "title": r[1], "cited_count": r[2]} for r in _iter(res)]


def never_cited_docs(conn: kuzu.Connection, company_id: str, limit: int = 20) -> list[dict]:
    """Documents that have never been cited in an answer - candidate dead weight."""
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:OWNS]->(d:Document)
           WHERE coalesce(d.cited_count, 0) = 0
           RETURN d.id, d.title, d.updated_at
           ORDER BY d.updated_at ASC LIMIT $limit""",
        {"cid": company_id, "limit": limit},
    )
    return [{"doc_id": r[0], "title": r[1],
             "updated_at": r[2].isoformat() if r[2] else None} for r in _iter(res)]


def roi(conn: kuzu.Connection, company_id: str) -> dict:
    """Deflection rate + estimated time saved from self-served answers."""
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:ASKED]->(q:EmployeeQuestion)
           RETURN coalesce(sum(q.asked_count),0), coalesce(sum(q.unanswered_count),0)""",
        {"cid": company_id},
    )
    asked, unanswered = (res.get_next() if res.has_next() else (0, 0))
    asked, unanswered = int(asked), int(unanswered)
    answered = max(0, asked - unanswered)
    return {
        "asked": asked,
        "answered": answered,
        "unanswered": unanswered,
        "deflection_rate": round(answered / asked, 3) if asked else 0.0,
        "minutes_saved": answered * _MINUTES_PER_ANSWER,
    }


_DRAFT_PROMPT = """A worker asked this and the company has NO document that answers it:

"{question}"

Write a short internal knowledge-base document that would answer it, as a helpful starting
draft for a subject-matter expert to review and correct. Use clear, plain company style.
Do NOT invent specific numbers, names, or policies you can't know — where a real value is
needed, write a bracketed placeholder like [X days] or [team name] for a human to fill in.

Return ONLY JSON: {{"title": "<short doc title>", "text": "<the draft, a few short paragraphs>"}}
"""


def draft_answer(company_id: str, question: str) -> dict:
    """LLM-draft a document that would answer an unanswered question (gap closure)."""
    import json

    raw = complete(
        _DRAFT_PROMPT.format(question=question),
        model=settings.generation_model,
        max_tokens=700,
        temperature=0.4,
        json_mode=True,
    )
    try:
        data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    except (json.JSONDecodeError, ValueError):
        data = {}
    return {
        "title": data.get("title") or question[:60],
        "text": data.get("text") or "",
        "question": question,
    }


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
    never = never_cited_docs(conn, company_id, limit=100)
    return {
        "documents": docs,
        "facts": facts,
        "topics": topics,
        "questions_asked": questions,
        "stale_count": len(stale),
        "gaps_count": len(gaps),
        "never_cited_count": len(never),
        "roi": roi(conn, company_id),
        "top_topics": topic_coverage(conn, company_id, limit=6),
        "top_questions": top_questions(conn, company_id, limit=5),
        "top_gaps": gaps[:5],
        "stale_docs": stale[:5],
        "most_cited": most_cited_docs(conn, company_id, limit=5),
        "questions_by_topic": questions_by_topic(conn, company_id)[:6],
    }


def list_documents(conn: kuzu.Connection, company_id: str, groups: list[str] | None = None) -> list[dict]:
    """Every document (visible to `groups`) with its fact count, topics, version, freshness."""
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:OWNS]->(d:Document)
           OPTIONAL MATCH (d)-[:STATES]->(f:Fact)
           OPTIONAL MATCH (d)-[:ABOUT]->(t:Topic)
           RETURN d.id, d.title, d.source, d.url, d.version, d.updated_at,
                  d.owner, d.verified_at, d.audience,
                  count(DISTINCT f) AS facts, collect(DISTINCT t.name) AS topics
           ORDER BY d.updated_at DESC""",
        {"cid": company_id},
    )
    cutoff = datetime.now() - timedelta(days=settings.review_days)
    out: list[dict] = []
    while res.has_next():
        did, title, source, url, version, updated_at, owner, verified_at, audience, facts, topics = res.get_next()
        if not can_see(audience, groups):
            continue
        out.append(
            {
                "doc_id": did, "title": title, "source": source, "url": url or None,
                "version": version, "updated_at": updated_at.isoformat() if updated_at else None,
                "owner": owner or None,
                "verified": bool(verified_at and verified_at >= cutoff),
                "verified_at": verified_at.isoformat() if verified_at else None,
                "audience": audience or ["everyone"],
                "facts": facts, "topics": [t for t in topics if t],
            }
        )
    return out


def get_document(conn: kuzu.Connection, company_id: str, doc_id: str,
                 groups: list[str] | None = None) -> dict | None:
    """Full document detail: text, extracted facts, topics, version, freshness.

    Returns None if the doc doesn't exist OR the caller's groups can't see it.
    """
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:OWNS]->(d:Document {id:$did})
           RETURN d.title, d.source, d.url, d.text, d.version, d.updated_at,
                  d.owner, d.verified_at, d.audience""",
        {"cid": company_id, "did": doc_id},
    )
    if not res.has_next():
        return None
    title, source, url, text, version, updated_at, owner, verified_at, audience = res.get_next()
    if not can_see(audience, groups):
        return None
    cutoff = datetime.now() - timedelta(days=settings.review_days)

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
        "owner": owner or None,
        "verified": bool(verified_at and verified_at >= cutoff),
        "verified_at": verified_at.isoformat() if verified_at else None,
        "audience": audience or ["everyone"],
        "facts": facts, "topics": topics,
    }


def set_audience(conn: kuzu.Connection, doc_id: str, audience: list[str]) -> None:
    """Set which groups can see a document ('everyone' = public)."""
    aud = audience or ["everyone"]
    conn.execute("MATCH (d:Document {id:$id}) SET d.audience=$aud", {"id": doc_id, "aud": aud})


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
