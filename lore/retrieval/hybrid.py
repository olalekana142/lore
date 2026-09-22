"""Hybrid-retrieval primitives: lexical BM25 + rank fusion.

Dense (embedding) search finds semantically similar facts even when wording differs;
lexical BM25 nails exact terms — numbers ("25 days"), acronyms (MFA), IDs (ext 4357),
proper nouns. Fusing both (Reciprocal Rank Fusion) is more robust than either alone,
especially as the corpus grows. Pure-Python, no extra dependency — fine at this scale.
"""

from __future__ import annotations

import math
import re
from collections import Counter

_TOKEN = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


def bm25_scores(query: str, corpus_tokens: list[list[str]], k1: float = 1.5, b: float = 0.75) -> list[float]:
    """Okapi BM25 score of `query` against each pre-tokenized document."""
    n = len(corpus_tokens)
    if n == 0:
        return []
    avgdl = sum(len(d) for d in corpus_tokens) / n or 1.0
    df: Counter = Counter()
    for doc in corpus_tokens:
        for term in set(doc):
            df[term] += 1

    q_terms = [t for t in tokenize(query) if t in df]
    scores = [0.0] * n
    for i, doc in enumerate(corpus_tokens):
        if not doc:
            continue
        tf = Counter(doc)
        dl = len(doc)
        s = 0.0
        for t in q_terms:
            f = tf.get(t, 0)
            if not f:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / avgdl))
        scores[i] = s
    return scores


def rank_indices(scores: list[float]) -> list[int]:
    """Indices ordered best-first by score (descending)."""
    return sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)


def rrf(rankings: list[list[int]], k: int = 60, weights: list[float] | None = None) -> dict[int, float]:
    """(Weighted) Reciprocal Rank Fusion: combine rankings into one score per item.

    Each ranking is a list of item indices, best first. Weights let one retriever
    dominate — we keep dense (semantic) primary and use lexical as a booster, so BM25
    rescues exact-term matches without demoting strong semantic hits.
    """
    weights = weights or [1.0] * len(rankings)
    fused: dict[int, float] = {}
    for ranking, w in zip(rankings, weights):
        for rank, idx in enumerate(ranking):
            fused[idx] = fused.get(idx, 0.0) + w / (k + rank + 1)
    return fused
