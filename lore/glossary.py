"""Company glossary — expand acronyms/jargon before retrieval.

Internal questions are full of company shorthand ("What's our MDM policy?", "How much
for BYOD?"). Expanding known terms into their meaning before we embed the query — and
telling the model what they mean — measurably improves retrieval and answers, cheaply.
"""

from __future__ import annotations

import re

import kuzu


def _slug(term: str) -> str:
    return "term:" + re.sub(r"[^a-z0-9]+", "-", term.lower()).strip("-")


def list_terms(conn: kuzu.Connection, company_id: str) -> list[dict]:
    res = conn.execute(
        "MATCH (c:Company {id:$cid})-[:DEFINES]->(g:GlossaryTerm) "
        "RETURN g.term, g.definition ORDER BY g.term",
        {"cid": company_id},
    )
    out = []
    while res.has_next():
        term, definition = res.get_next()
        out.append({"term": term, "definition": definition})
    return out


def add_term(conn: kuzu.Connection, company_id: str, term: str, definition: str) -> None:
    conn.execute("MERGE (c:Company {id:$cid}) ON CREATE SET c.name=$cid", {"cid": company_id})
    tid = _slug(term)
    conn.execute(
        "MERGE (g:GlossaryTerm {id:$id}) SET g.term=$term, g.definition=$def",
        {"id": tid, "term": term.strip(), "def": definition.strip()},
    )
    conn.execute(
        "MATCH (c:Company {id:$cid}), (g:GlossaryTerm {id:$id}) MERGE (c)-[:DEFINES]->(g)",
        {"cid": company_id, "id": tid},
    )


def expand_query(conn: kuzu.Connection, company_id: str, question: str) -> dict:
    """Detect glossary terms in the question; return an expanded query + the hits.

    The expanded text (question + "term (definition)") is what we embed for retrieval;
    the hits are injected into the model's context so it knows the jargon.
    """
    terms = list_terms(conn, company_id)
    if not terms:
        return {"query": question, "hits": []}

    hits = []
    for t in terms:
        # whole-word, case-insensitive match of the term in the question
        if re.search(rf"\b{re.escape(t['term'])}\b", question, flags=re.IGNORECASE):
            hits.append(t)
    if not hits:
        return {"query": question, "hits": []}

    expansion = " ".join(f"{h['term']} ({h['definition']})" for h in hits)
    return {"query": f"{question} {expansion}", "hits": hits}
