"""Embeddings + fact de-duplication.

Real semantic embeddings via **fastembed** (BAAI/bge-small-en-v1.5, 384-dim, ONNX —
local, no API key, no torch). Groq has no embeddings endpoint, so we embed locally.

The same fact stated across many documents collapses to one node: we embed each fact's
statement and merge near-duplicates by cosine similarity, so a shared policy fact isn't
duplicated per document.

If fastembed isn't installed (e.g. CI / offline unit tests), we fall back to a
deterministic hash embedding so the graph/dedupe logic still runs end-to-end.
"""

from __future__ import annotations

import hashlib
import os

import numpy as np

_MODEL_NAME = "BAAI/bge-small-en-v1.5"
# Pin the model cache dir when set (e.g. baked into a Docker image) so runtime needs
# no network. Unset -> fastembed's default temp cache (downloads on first use).
_CACHE_DIR = os.environ.get("LORE_EMBED_CACHE") or None
DEDUPE_THRESHOLD = 0.88  # tuned for real embeddings (higher-quality space, less noise)

_model = None
_use_real = True


def _get_model():
    """Lazily load the embedding model once per process."""
    global _model, _use_real
    if _model is None and _use_real:
        try:
            from fastembed import TextEmbedding

            _model = TextEmbedding(_MODEL_NAME, cache_dir=_CACHE_DIR)
        except Exception:
            _use_real = False  # fall back to hash embeddings
    return _model


def embed_text(text: str) -> list[float]:
    """Return a semantic embedding for `text`."""
    model = _get_model()
    if model is not None:
        return list(model.embed([text]))[0].tolist()
    return _hash_embed(text)


def embed_many(texts: list[str]) -> list[list[float]]:
    """Batch embed — much faster than one-at-a-time for ingestion."""
    if not texts:
        return []
    model = _get_model()
    if model is not None:
        return [v.tolist() for v in model.embed(texts)]
    return [_hash_embed(t) for t in texts]


def _hash_embed(text: str, dim: int = 384) -> list[float]:
    """Deterministic offline fallback (NOT semantic — dev/test only)."""
    h = hashlib.sha256(text.lower().encode("utf-8")).digest()
    rng = np.random.default_rng(int.from_bytes(h[:8], "big"))
    v = rng.standard_normal(dim)
    v /= np.linalg.norm(v) or 1.0
    return v.tolist()


def cosine(a: list[float], b: list[float]) -> float:
    va, vb = np.asarray(a), np.asarray(b)
    if va.shape != vb.shape:
        return 0.0
    denom = (np.linalg.norm(va) * np.linalg.norm(vb)) or 1.0
    return float(va @ vb / denom)


def dedupe_key(embedding: list[float], seen: dict[str, list[float]]) -> str | None:
    """Return the id of an existing fact this embedding duplicates, else None."""
    for existing_id, vec in seen.items():
        if cosine(embedding, vec) >= DEDUPE_THRESHOLD:
            return existing_id
    return None
