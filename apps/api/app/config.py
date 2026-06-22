"""Runtime settings, loaded from environment / .env."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database (resolution handled in yunoball_db.base)
    database_url: str | None = None
    readonly_database_url: str | None = None

    # Cache
    redis_url: str = "redis://localhost:6379/0"
    answer_cache_ttl_seconds: int = 60 * 60 * 24  # 24h

    # LLM (OpenAI for both generation and embeddings)
    openai_api_key: str | None = None
    sql_model: str = "gpt-4o"
    narrate_model: str = "gpt-4o-mini"
    embedding_model: str = "text-embedding-3-small"

    # Server
    api_port: int = 4000
    cors_origins: list[str] = ["http://localhost:3000"]


settings = Settings()
