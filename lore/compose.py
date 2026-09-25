"""Turn a grounded answer into a ready-to-use work product (email, checklist, FAQ, memo…).

This is an employee-workspace feature: it moves Lore from "answering" to "doing" without
sacrificing trust. It reformats an ALREADY grounded + cited answer — it must not introduce
new facts — so the resulting artifact stays faithful to the underlying documents.
"""

from __future__ import annotations

from lore.config import settings
from lore.llm import complete

# format key -> (human label, instruction)
FORMATS: dict[str, tuple[str, str]] = {
    "email": ("email", "a concise, friendly email a coworker could send as-is (subject line + body)"),
    "slack": ("Slack message", "a short, skimmable Slack message (plain, a few lines, light formatting)"),
    "checklist": ("checklist", "a clear step-by-step checklist as markdown '- [ ]' items"),
    "faq": ("FAQ entry", "a short FAQ entry: the question as a heading, then a crisp answer"),
    "memo": ("memo", "a brief memo with a bold title, 2-4 sentences, and a one-line takeaway"),
}


def compose(question: str, answer: str, fmt: str) -> dict:
    """Reformat a grounded answer into the requested work product."""
    label, instruction = FORMATS.get(fmt, FORMATS["email"])
    prompt = (
        f"Reformat the ANSWER below into {instruction}.\n"
        "Rules: use ONLY the information in the answer — do not add facts, numbers or claims. "
        "Keep any [n] citation markers where they belong. Output only the result, no preamble.\n\n"
        f"QUESTION: {question}\n\nANSWER:\n{answer}"
    )
    text = complete(prompt, model=settings.generation_model, max_tokens=600, temperature=0.3)
    return {"format": fmt, "label": label, "content": text.strip()}
