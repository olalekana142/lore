"""Challenge an answer — adversarial self-verification.

Most RAG shows the evidence FOR an answer. This deliberately hunts for evidence AGAINST it:
it widens the search to include the superseded / low-authority / non-canonical facts normal
retrieval demotes, asks the model which of them CONTRADICT the answer, then resolves each
challenge using document provenance.

    answer ──► gather contradicting candidates (incl. demoted) ──► LLM: which contradict?
           └─► resolve each vs the defending source (superseded? lower authority? beaten by
               the canonical source?) ──► verdict: survives / contested / unchallenged

An answer "survives" when every contradicting fact is beaten by provenance; it is "contested"
when a challenger is current and of comparable authority — a real conflict a human must settle.
"""

from __future__ import annotations

import json

import kuzu

from lore.config import settings
from lore.ingestion.embed import cosine, embed_text
from lore.llm import complete

_FIND_PROMPT = """You are stress-testing a colleague's answer. Below is the ANSWER, then
numbered CANDIDATE FACTS from company documents. Return ONLY the facts that CONTRADICT the
answer (state something incompatible with it) — not facts that merely differ in topic or
that agree.

Return ONLY JSON: {{"contradictions": [{{"i": <fact number>, "why": "<=12 words"}}]}}

ANSWER:
\"\"\"{answer}\"\"\"

CANDIDATE FACTS:
{facts}
"""


def _resolve(ch: dict, defender: dict | None) -> tuple[str, bool]:
    """How the challenge is resolved vs the defending source. Returns (reason, beaten)."""
    if ch["superseded"]:
        return "superseded — no longer in force", True
    if defender:
        if defender.get("canonical") and not ch.get("canonical"):
            return f"overridden by the canonical source “{defender['title']}”", True
        if (defender.get("authority") or 60) > ch["authority"]:
            return f"lower authority than “{defender['title']}”", True
        if defender.get("verified") and not ch["verified"]:
            return f"unverified vs the verified “{defender['title']}”", True
    return "current and of comparable authority — a genuine conflict", False


def challenge_answer(conn: kuzu.Connection, company_id: str, question: str,
                     groups: list[str] | None = None) -> dict:
    """Re-derive the answer, then adversarially search for contradicting evidence."""
    from lore import health
    from lore.retrieval.answer import retrieve, synthesize

    r = retrieve(conn, company_id, question, groups=groups)
    ans = synthesize(question, r)
    if ans["confidence"] == "none" or not ans["sources"]:
        return {"question": question, "answer": ans["answer"], "verdict": "no_answer",
                "challenges": [], "defender": None}

    defender_ids = {s["doc_id"] for s in ans["sources"]}
    # strongest defending source (canonical first, then authority) — what a challenger faces
    defender = max(ans["sources"], key=lambda s: (int(bool(s.get("canonical"))), s.get("authority") or 60))

    # Candidate pool = every visible fact NOT from a defending document, incl. demoted ones.
    pool = [f for f in health._active_facts(conn, company_id, groups) if f["doc_id"] not in defender_ids]
    avec = embed_text(ans["answer"])
    pool.sort(key=lambda f: cosine(avec, f["emb"]), reverse=True)
    pool = pool[:12]
    if not pool:
        return {"question": question, "answer": ans["answer"], "verdict": "unchallenged",
                "challenges": [], "defender": _pub(defender)}

    listing = "\n".join(f"{i + 1}. \"{f['statement']}\" (source: {f['title']})" for i, f in enumerate(pool))
    raw = complete(_FIND_PROMPT.format(answer=ans["answer"], facts=listing),
                   model=settings.generation_model, max_tokens=400, temperature=0.1, json_mode=True)
    try:
        data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        hits = data.get("contradictions", []) if isinstance(data, dict) else []
    except (json.JSONDecodeError, ValueError):
        hits = []

    challenges, contested = [], False
    seen: set[str] = set()
    for h in hits:
        try:
            idx = int(h.get("i", 0)) - 1
        except (TypeError, ValueError):
            continue
        if not (0 <= idx < len(pool)):
            continue
        f = pool[idx]
        if f["fact_id"] in seen:
            continue
        seen.add(f["fact_id"])
        reason, beaten = _resolve(f, defender)
        if not beaten:
            contested = True
        challenges.append({
            "statement": f["statement"], "title": f["title"], "doc_id": f["doc_id"],
            "why": (h.get("why") or "")[:80], "resolution": reason, "beaten": beaten,
            "superseded": f["superseded"], "authority": f["authority"], "verified": f["verified"],
        })

    verdict = "contested" if contested else ("survives" if challenges else "unchallenged")
    return {"question": question, "answer": ans["answer"], "verdict": verdict,
            "challenges": challenges, "defender": _pub(defender)}


def _pub(s: dict | None) -> dict | None:
    if not s:
        return None
    return {"doc_id": s["doc_id"], "title": s["title"], "authority": s.get("authority"),
            "canonical": bool(s.get("canonical")), "verified": bool(s.get("verified"))}
