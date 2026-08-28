"""Single place all LLM calls go through — currently Groq.

Groq serves open models (GPT-OSS, Qwen, Llama, ...) over an OpenAI-compatible chat API
and is very fast. Centralizing here means swapping providers later touches one file, not
every call site. Extraction uses a small/fast model; answer synthesis a larger one.

Note: the default models (openai/gpt-oss-*) are *reasoning* models. For structured
extraction we ask for JSON mode + low reasoning effort so the token budget goes to the
answer, not the chain-of-thought (which otherwise sometimes leaves content empty).
"""

from __future__ import annotations

from groq import Groq

from lore.config import settings

_client: Groq | None = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=settings.groq_api_key)
    return _client


def complete(
    prompt: str,
    *,
    model: str,
    max_tokens: int = 512,
    temperature: float = 0.7,
    json_mode: bool = False,
    reasoning_effort: str | None = None,
) -> str:
    """Run a single-prompt chat completion and return the text.

    json_mode:        force a valid JSON object response (for extraction/classification).
    reasoning_effort: 'low' | 'medium' | 'high' for reasoning models — 'low' keeps
                      structured calls fast and stops CoT from eating the token budget.
    """
    kwargs: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [{"role": "user", "content": prompt}],
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if reasoning_effort:
        kwargs["reasoning_effort"] = reasoning_effort

    resp = _get_client().chat.completions.create(**kwargs)
    return resp.choices[0].message.content or ""


def stream_chat(
    messages: list[dict],
    *,
    model: str,
    max_tokens: int = 700,
    temperature: float = 0.2,
):
    """Stream a multi-turn chat completion, yielding text deltas as they arrive.

    Used by the conversational Ask endpoint so answers render token-by-token.
    """
    stream = _get_client().chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=messages,
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            yield delta
