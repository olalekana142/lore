"""Claim-level answer verification — grounded generation, not "is this answer correct?".

The draft answer is decomposed into ATOMIC claims; each is checked for entailment against
the retrieved evidence ONLY. Unsupported claims (usually over-generalisations —
"guaranteed", "everyone", "unlimited", "from day one") are removed or qualified, and a
revised answer is produced that keeps the supported claims with their [n] citations.

Deliberately a SEPARATE pass (not folded into generation): a fact-checker prompt with a
narrow job is more reliable than asking the author model to grade itself. Its cost/benefit
is measured in the eval harness (verifier on vs off) so it only ships if it fixes the
unsupported-inference failures WITHOUT over-rejecting legitimate answers.
"""

from __future__ import annotations

import json

from lore.config import settings
from lore.llm import complete

_VERIFY_PROMPT = """You are a strict fact-checker for a company knowledge assistant.
Break the DRAFT answer into atomic claims and check EACH against the EVIDENCE only.

Rules:
- A claim is SUPPORTED only if the evidence directly states it. Never infer beyond it.
- Flag over-generalisations the evidence does NOT establish (e.g. "guaranteed",
  "everyone", "unlimited", "automatically", "from day one", "fully paid", "always").
- Write a REVISED answer that keeps supported claims (with their [n] citations) and
  REMOVES or explicitly QUALIFIES unsupported ones. Keep it natural, concise, and do not
  add new facts. If everything is supported, return the draft essentially unchanged.

EVIDENCE:
{facts}

DRAFT:
{draft}

Return ONLY JSON:
{{"claims": [{{"claim": "<atomic claim>", "supported": true|false}}],
  "revised": "<revised answer with [n] citations>"}}
"""


def verify_answer(question: str, draft: str, facts: list[dict]) -> dict | None:
    """Return {claims, revised, changed} or None on failure (caller keeps the draft)."""
    if not facts or not draft.strip():
        return None
    fact_lines = "\n".join(f"[{f['n']}] {f['statement']}" for f in facts)
    raw = complete(
        _VERIFY_PROMPT.format(facts=fact_lines, draft=draft),
        model=settings.generation_model,
        max_tokens=700,
        temperature=0.0,
        json_mode=True,
        reasoning_effort="low",
    )
    try:
        data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    except (json.JSONDecodeError, ValueError):
        return None
    claims = data.get("claims") or []
    revised = (data.get("revised") or "").strip()
    if not revised:
        return None
    unsupported = any(not c.get("supported", True) for c in claims)
    return {"claims": claims, "revised": revised, "changed": unsupported}
