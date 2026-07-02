"""Runtime settings, loaded from environment / .env.

Two modes:
  - production: Postgres + OpenAI + Redis
  - demo      : SQLite + rule-based parser + seeded sample data, no API keys

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

    # LLM (OpenAI) — used only to parse a question into a QuerySpec.
    openai_api_key: str | None = None
    sql_model: str = "gpt-4o"

    # Server
    api_port: int = 4000
    cors_origins: list[str] = ["http://localhost:3000"]
    # Hard cap on generated-SQL execution time (Postgres only).
    statement_timeout_ms: int = 10_000
    # Requests per client IP per minute on POST /api/search (0 disables).
    # Fails open when Redis is unavailable or the in-process demo cache is used.
    rate_limit_per_minute: int = 30

    # Demo
    demo: bool = False
    demo_db_path: str = os.path.join(os.getcwd(), "yunoball_demo.db")

    # ---- derived ----
    #
    # Two independent axes:
    #   use_mock_llm — no OpenAI key (or DEMO=1) → rule-based NL->SQL
    #   use_sqlite   — no DATABASE_URL → seeded SQLite demo file
    # This lets the rule-based engine serve a real, fully-loaded Postgres
    # (DATABASE_URL set, no OpenAI key) — real data with zero API cost.

    @property
    def use_mock_llm(self) -> bool:
        return self.demo or not self.openai_api_key

    @property
    def use_sqlite(self) -> bool:
        return not self.database_url

    @property
    def demo_mode(self) -> bool:
        """Backwards-compatible flag: true when either side is in demo."""
        return self.use_mock_llm or self.use_sqlite

    @property
    def effective_database_url(self) -> str:
        if self.use_sqlite:
            return f"sqlite:///{self.demo_db_path}"
        return self.database_url or ""

    @property
    def effective_readonly_url(self) -> str:
        if self.use_sqlite:
            return f"sqlite:///{self.demo_db_path}"
        return self.readonly_database_url or self.database_url or ""

    @property
    def sql_dialect(self) -> str:
        return "sqlite" if self.use_sqlite else "postgres"


settings = Settings()
