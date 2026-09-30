"""Document intelligence — work with any document a person pastes in.

An employee-workspace feature that reaches beyond the company wiki: drop in a contract, an
offer letter, a vendor doc, and ask for a summary, the obligations, the unusual clauses, or
the action items — or compare two documents and see exactly what changed. It operates on the
pasted text only (grounded in that document), so it stays faithful to what's in front of you.
"""

from __future__ import annotations

import json

from lore.config import settings
from lore.llm import complete

# mode -> (label, instruction)
MODES: dict[str, tuple[str, str]] = {
    "summary": ("Summary", "Summarize the document in 3-5 tight bullet points a busy colleague can skim."),
    "obligations": ("Obligations", "List the concrete obligations, commitments and deadlines, and who each falls on."),
    "risks": ("Unusual / risky clauses", "Flag any unusual, one-sided, risky or non-standard clauses or terms, and say why each stands out. If nothing stands out, say so."),
    "actions": ("Action items", "Extract the action items / next steps as a markdown '- [ ]' checklist, with an owner where stated."),
}


def analyze(text: str, mode: str) -> dict:
    label, instruction = MODES.get(mode, MODES["summary"])
    prompt = (
        f"{instruction}\nUse ONLY the document below — do not invent facts. Be concise, no preamble.\n\n"
        f"DOCUMENT:\n\"\"\"{text[:9000]}\"\"\""
    )
    out = complete(prompt, model=settings.generation_model, max_tokens=700, temperature=0.2)
    return {"mode": mode, "label": label, "content": out.strip()}


_COMPARE_PROMPT = """Compare two versions of a document (A = current/old, B = new/proposed).
Return ONLY JSON:
{{
  "added":         ["something present in B but not A", "..."],
  "removed":       ["something in A but dropped in B", "..."],
  "changed":       [{{"was": "the A wording/value", "now": "the B wording/value"}}],
  "contradictions":["places where A and B directly conflict"],
  "review":        ["anything a human should double-check before accepting B"]
}}
Only include real differences. Use [] for empty sections.

DOCUMENT A:
\"\"\"{a}\"\"\"

DOCUMENT B:
\"\"\"{b}\"\"\"
"""


def compare(text_a: str, text_b: str) -> dict:
    raw = complete(_COMPARE_PROMPT.format(a=text_a[:6000], b=text_b[:6000]),
                   model=settings.generation_model, max_tokens=900, temperature=0.1, json_mode=True)
    try:
        data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    except (json.JSONDecodeError, ValueError):
        data = {}

    def _strs(v):
        return [s for s in (v or []) if isinstance(s, str) and s.strip()]

    changed = [{"was": (c.get("was") or "").strip(), "now": (c.get("now") or "").strip()}
               for c in (data.get("changed") or []) if isinstance(c, dict) and (c.get("was") or c.get("now"))]
    return {
        "added": _strs(data.get("added")), "removed": _strs(data.get("removed")),
        "changed": changed, "contradictions": _strs(data.get("contradictions")),
        "review": _strs(data.get("review")),
    }
