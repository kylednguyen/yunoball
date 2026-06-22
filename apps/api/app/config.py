"""Runtime settings, loaded from environment / .env.

Two modes:
  - production: Postgres + pgvector + OpenAI + Redis
  - demo      : SQLite + rule-based NL->SQL + seeded sample data, no API keys

Demo mode activates automatically when OPENAI_API_KEY is unset (or DEMO=1),
so the prototype is runnable with a single command and zero external services.
"""

from __future__ import annotations

import os

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database (production)
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

    # Demo
    demo: bool = False
    demo_db_path: str = os.path.join(os.getcwd(), "yunoball_demo.db")

    # ---- derived ----

    @property
    def demo_mode(self) -> bool:
        return self.demo or not self.openai_api_key

    @property
    def effective_database_url(self) -> str:
        if self.demo_mode:
            return f"sqlite:///{self.demo_db_path}"
        return self.database_url or ""

    @property
    def effective_readonly_url(self) -> str:
        if self.demo_mode:
            return f"sqlite:///{self.demo_db_path}"
        return self.readonly_database_url or self.database_url or ""

    @property
    def sql_dialect(self) -> str:
        return "sqlite" if self.demo_mode else "postgres"


settings = Settings()
