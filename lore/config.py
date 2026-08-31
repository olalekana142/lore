"""Central configuration, loaded from environment / .env.

Keeps model IDs and paths in one place so nothing is hard-coded across modules.
"""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    # --- Groq API (open models) ---
    groq_api_key: str = ""
    # Fast/small model for high-volume fact extraction; larger model for answer synthesis.
    # (Override via EXTRACTION_MODEL / GENERATION_MODEL in .env. Check available models
    #  for your key with: client.models.list().)
    extraction_model: str = "openai/gpt-oss-20b"
    generation_model: str = "openai/gpt-oss-120b"

    # --- Retrieval knobs ---
    answer_top_k: int = 6          # how many facts to ground an answer on
    min_relevance: float = 0.25    # facts below this cosine sim are ignored as noise

    # --- Trust / freshness ---
    review_days: int = 180         # a doc verified longer ago than this reads as "Unverified"

    # --- Auth ---
    secret_key: str = "dev-insecure-change-me-in-prod"  # signs session tokens; override in .env
    session_hours: int = 24

    # --- Storage ---
    db_path: Path = Path("./data/lore.kuzu")

    def ensure_db_dir(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)


settings = Settings()
