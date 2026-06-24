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

    # LLM — OpenAI-compatible. Point llm_base_url at any compatible server
    # (e.g. Ollama: http://localhost:11434/v1) to run locally.
    openai_api_key: str | None = None
    llm_base_url: str | None = None
    sql_model: str = "gpt-4o"
    narrate_model: str = "gpt-4o-mini"
    embedding_model: str = "text-embedding-3-small"
    # Embeddings power the pgvector paths (entity backstop + few-shot). Disable
    # when the LLM backend has no 1536-dim embedding model (e.g. Ollama); the
    # app falls back to trigram + keyword retrieval.
    embeddings_enabled: bool = True

    # Server
    api_port: int = 4000
    cors_origins: list[str] = ["http://localhost:3000"]

    @property
    def llm_configured(self) -> bool:
        """True when chat/narration can run (a key or a custom endpoint is set)."""
        return bool(self.openai_api_key or self.llm_base_url)

    @property
    def embeddings_active(self) -> bool:
        return self.llm_configured and self.embeddings_enabled


settings = Settings()
