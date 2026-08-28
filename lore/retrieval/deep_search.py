"""Semantic fact search - embed the query, rank every fact by cosine similarity.

Returns the raw matching facts with their source document. Useful on its own (a
"search the knowledge base" view) and as the retrieval primitive behind `answer`.
"""

from __future__ import annotations

import kuzu

from lore.ingestion.embed import cosine, embed_text


def deep_search_facts(
    conn: kuzu.Connection, company_id: str, query: str, top_k: int = 8
) -> list[dict]:
    query_vec = embed_text(query)
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:OWNS]->(d:Document)-[:STATES]->(f:Fact)
           RETURN f.id, f.statement, f.embedding, d.title, d.url""",
        {"cid": company_id},
    )
    scored: list[dict] = []
    while res.has_next():
        fid, statement, emb, title, url = res.get_next()
        if not emb:
            continue
        scored.append(
            {
                "fact_id": fid,
                "statement": statement,
                "title": title,
                "url": url or None,
                "similarity": round(cosine(query_vec, emb), 4),
            }
        )
    scored.sort(key=lambda r: r["similarity"], reverse=True)
    return scored[:top_k]
