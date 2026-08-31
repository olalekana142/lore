"""Ask the Company — retrieve-then-synthesize with citations.

The core worker experience: a natural-language question in, a grounded answer out, with
citations to the source documents. Flow:

    embed(question) -> score every Fact by cosine -> take the top-K most relevant ->
    group facts by their source Document -> ask the LLM to answer using ONLY those
    facts, citing sources by [n] -> return {answer, sources[], confidence}

`retrieve()` is shared by the streaming and non-streaming paths and by the analytics
question-logger. `build_messages()` supports multi-turn follow-ups (conversation memory).
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta

import kuzu

from lore.config import settings
from lore.ingestion.embed import cosine, embed_text
from lore.llm import complete

_SYSTEM_PROMPT = """You are the company's internal knowledge assistant. Answer each
question using ONLY the numbered facts provided with that question. Each fact is tagged
with the source document it came from.

Rules:
- Use only what the facts state. Do NOT use outside knowledge or guess.
- Cite the source(s) you used inline as [n], matching the fact's [n] tag.
- If the facts do not contain the answer, say so plainly and suggest who/where to ask.
- Be concise and direct - this is for a busy coworker. Prefer short paragraphs or bullets."""


def retrieve(conn: kuzu.Connection, company_id: str, question: str, top_k: int | None = None) -> dict:
    """Return the top facts for a question plus numbered source documents.

    Result: {query_vec, facts[], sources[], confidence, top_similarity, glossary[]}. Each
    source carries the fact statements retrieved from it, so the UI can show what a
    citation says. Known glossary terms in the question are expanded before embedding.
    """
    from lore.glossary import expand_query  # local import avoids a cycle

    top_k = top_k or settings.answer_top_k
    expanded = expand_query(conn, company_id, question)
    query_vec = embed_text(expanded["query"])
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:OWNS]->(d:Document)-[:STATES]->(f:Fact)
           RETURN f.id, f.statement, f.embedding,
                  d.id, d.title, d.url, d.updated_at, d.version, d.owner, d.verified_at""",
        {"cid": company_id},
    )
    verify_cutoff = datetime.now() - timedelta(days=settings.review_days)
    scored: list[dict] = []
    while res.has_next():
        fid, statement, emb, did, title, url, updated_at, version, owner, verified_at = res.get_next()
        if not emb:
            continue
        sim = cosine(query_vec, emb)
        if sim < settings.min_relevance:
            continue
        scored.append(
            {
                "fact_id": fid, "statement": statement, "similarity": round(sim, 4),
                "doc_id": did, "title": title, "url": url,
                "updated_at": updated_at.isoformat() if updated_at else None,
                "version": version,
                "owner": owner or None,
                "verified": bool(verified_at and verified_at >= verify_cutoff),
            }
        )
    scored.sort(key=lambda r: r["similarity"], reverse=True)
    facts = scored[:top_k]

    # Number the DISTINCT source documents; attach the facts pulled from each.
    sources: list[dict] = []
    doc_num: dict[str, int] = {}
    for f in facts:
        if f["doc_id"] not in doc_num:
            doc_num[f["doc_id"]] = len(sources) + 1
            sources.append(
                {
                    "n": len(sources) + 1, "doc_id": f["doc_id"], "title": f["title"],
                    "url": f["url"] or None, "updated_at": f["updated_at"],
                    "version": f["version"], "owner": f["owner"], "verified": f["verified"],
                    "facts": [],
                }
            )
        sources[doc_num[f["doc_id"]] - 1]["facts"].append(f["statement"])
        f["n"] = doc_num[f["doc_id"]]

    top_sim = facts[0]["similarity"] if facts else 0.0
    confidence = (
        "none" if not facts
        else "high" if top_sim >= 0.6
        else "medium" if top_sim >= 0.4
        else "low"
    )
    return {
        "query_vec": query_vec, "facts": facts, "sources": sources,
        "confidence": confidence, "top_similarity": top_sim,
        "glossary": expanded["hits"],
    }


def build_messages(
    question: str,
    facts: list[dict],
    history: list[dict] | None = None,
    glossary: list[dict] | None = None,
) -> list[dict]:
    """Assemble chat messages: system + prior turns + this question with its facts."""
    messages = [{"role": "system", "content": _SYSTEM_PROMPT}]
    for turn in history or []:
        role = turn.get("role")
        content = turn.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    gloss = ""
    if glossary:
        gloss = "GLOSSARY (company terms):\n" + "\n".join(
            f"- {g['term']}: {g['definition']}" for g in glossary
        ) + "\n\n"

    if facts:
        fact_lines = "\n".join(f"[{f['n']}] ({f['title']}) {f['statement']}" for f in facts)
        user = f"{gloss}FACTS:\n{fact_lines}\n\nQUESTION: {question}"
    else:
        user = (
            f"QUESTION: {question}\n\n"
            "(No matching facts were found in the company's documents.)"
        )
    messages.append({"role": "user", "content": user})
    return messages


def _finalize(text: str, sources: list[dict]) -> tuple[str, list[dict]]:
    """Normalize citation brackets and keep only the sources actually cited."""
    text = text.strip().replace("【", "[").replace("】", "]")
    cited = {int(n) for n in re.findall(r"\[(\d+)\]", text)}
    shown = [s for s in sources if s["n"] in cited] if cited else []
    return text, shown


def synthesize(question: str, r: dict, history: list[dict] | None = None) -> dict:
    """Turn a retrieve() result into a final answer dict (no extra retrieval)."""
    if not r["facts"]:
        return {
            "question": question,
            "answer": "I couldn't find anything about that in the company's documents yet. "
                      "It may not be documented - try rephrasing, or ask the relevant team.",
            "sources": [], "confidence": "none",
        }
    text = complete(
        _SYSTEM_PROMPT + "\n\n"
        + build_messages(question, r["facts"], history, r.get("glossary"))[-1]["content"],
        model=settings.generation_model,
        max_tokens=700,
        temperature=0.2,
    )
    text, shown = _finalize(text, r["sources"])
    # "Answered" = the model actually grounded its reply in a source.
    confidence = r["confidence"] if shown else "none"
    return {"question": question, "answer": text, "sources": shown, "confidence": confidence}


def answer(
    conn: kuzu.Connection,
    company_id: str,
    question: str,
    top_k: int | None = None,
    history: list[dict] | None = None,
) -> dict:
    """Non-streaming answer (used by MCP + the JSON /ask endpoint)."""
    return synthesize(question, retrieve(conn, company_id, question, top_k), history)


def cited_sources(text: str, sources: list[dict]) -> list[dict]:
    """Public helper for the streaming path: resolve [n] citations after streaming."""
    return _finalize(text, sources)[1]
