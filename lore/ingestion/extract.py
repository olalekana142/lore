"""Fact / topic extraction via the Groq API.

Turns one chunk of a company document into atomic, answerable `Fact`s plus the broad
`Topic`s it covers. Facts are phrased to stand on their own (so a retrieved fact makes
sense out of context) and are the unit answers are grounded on.
"""

from __future__ import annotations

import json

from lore.config import settings
from lore.llm import complete
from lore.models import ExtractionResult, Fact, Topic

_EXTRACTION_PROMPT = """You are building a company knowledge base. Read one section of an
internal document and extract the concrete, answerable facts a worker might ask about.

Return ONLY JSON matching this shape:
{{
  "facts":  [{{"statement": "one self-contained fact, stated plainly"}}],
  "topics": [{{"name": "broad theme / department, 1-3 words"}}]
}}

Rules:
- Each fact must stand alone (resolve pronouns; include the subject) so it is
  understandable without the surrounding text.
- Capture specifics: numbers, eligibility, steps, deadlines, owners, tools.
- Do NOT invent anything not stated in the section. 0 facts is fine if it's boilerplate.
- Topics are broad and reusable across many documents (e.g. "PTO", "Security", "Expenses").

DOCUMENT: {title}
SECTION:
\"\"\"{text}\"\"\"
"""


def extract(title: str, text: str, id_prefix: str) -> ExtractionResult:
    """Extract facts + topics from ONE chunk of a document.

    `id_prefix` makes fact ids unique+stable per document chunk (e.g. "upload:pto#0").
    """
    if not text.strip():
        return ExtractionResult()

    prompt = _EXTRACTION_PROMPT.format(title=title or "(untitled)", text=text[:4000])
    # Retry once: reasoning models occasionally return empty content on the first pass.
    data: dict = {}
    for _ in range(2):
        raw = complete(
            prompt,
            model=settings.extraction_model,
            max_tokens=900,
            temperature=0.1,      # low - extraction should be faithful, not creative
            json_mode=True,       # force valid JSON
            reasoning_effort="low",  # keep the token budget on the answer, not CoT
        )
        data = _safe_json(raw)
        if data.get("facts"):
            break

    # The model USUALLY returns [{"statement": ...}] but sometimes bare strings — accept both.
    facts = []
    for n, item in enumerate(data.get("facts", [])):
        stmt = item.get("statement") if isinstance(item, dict) else item if isinstance(item, str) else None
        if stmt and stmt.strip():
            facts.append(Fact(id=f"{id_prefix}:fact:{n}", statement=stmt.strip()))
    topics = []
    for item in data.get("topics", []):
        name = item.get("name") if isinstance(item, dict) else item if isinstance(item, str) else None
        if name and name.strip():
            topics.append(Topic(id=f"topic:{name.lower().strip()}", name=name.strip()))
    return ExtractionResult(facts=facts, topics=topics)


def _safe_json(raw: str) -> dict:
    """Tolerate code fences / stray prose around the JSON object."""
    raw = raw.strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        return {}
    try:
        return json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return {}
