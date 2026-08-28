"""Split a long document into retrieval-sized chunks before fact extraction.

Company docs (handbooks, SOPs) can be long. We chunk on paragraph boundaries and cap
each chunk near `max_chars`, so the extraction LLM sees coherent, bounded text and we
get facts covering the WHOLE document rather than just the top.
"""

from __future__ import annotations

import re


def chunk_text(text: str, max_chars: int = 1200) -> list[str]:
    """Greedily pack paragraphs into chunks no larger than ~max_chars.

    A single paragraph longer than max_chars is hard-split on sentence boundaries.
    """
    text = text.strip()
    if not text:
        return []

    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    buf = ""
    for para in paras:
        if len(para) > max_chars:
            if buf:
                chunks.append(buf)
                buf = ""
            chunks.extend(_split_long(para, max_chars))
            continue
        if buf and len(buf) + len(para) + 2 > max_chars:
            chunks.append(buf)
            buf = para
        else:
            buf = f"{buf}\n\n{para}" if buf else para
    if buf:
        chunks.append(buf)
    return chunks


def _split_long(para: str, max_chars: int) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", para)
    out: list[str] = []
    buf = ""
    for s in sentences:
        if buf and len(buf) + len(s) + 1 > max_chars:
            out.append(buf)
            buf = s
        else:
            buf = f"{buf} {s}" if buf else s
    if buf:
        out.append(buf)
    return out
