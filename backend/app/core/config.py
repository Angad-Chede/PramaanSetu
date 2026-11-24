"""Environment-driven configuration. Twelve-factor: nothing environment-specific in code."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"), env_file_encoding="utf-8", extra="ignore"
    )

    # Application
    app_name: str = "PramaanSetu"
    environment: Literal["local", "staging", "demo", "production"] = "local"
    debug: bool = True
    api_prefix: str = "/api/v1"
    base_url: str = "http://localhost:8000"
    web_base_url: str = "http://localhost:3000"

    # Database. SQLite by default so the stack runs with no external service.
    # Set DATABASE_URL=postgresql+asyncpg://user:pass@host/db for the full topology.
    database_url: str = "sqlite+aiosqlite:///./pramaansetu.db"
    database_echo: bool = False
    db_pool_size: int = 10
    db_max_overflow: int = 20
    statement_timeout_ms: int = 5000
    lock_timeout_ms: int = 2000

    # Redis. Optional; when absent the system degrades to in-process equivalents
    # exactly as described in PRD section 10.6.
    redis_url: str | None = None

    # Security
    secret_key: str = "dev-only-change-me-in-every-deployed-environment"
    access_token_minutes: int = 15
    refresh_token_hours: int = 8
    otp_ttl_seconds: int = 300
    otp_length: int = 6
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    cookie_secure: bool = False
    cookie_domain: str | None = None
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    # Rate limits (PRD 10.9)
    rate_limit_otp_per_hour: int = 10
    rate_limit_writes_per_minute: int = 100
    rate_limit_reads_per_minute: int = 1000
    max_json_body_bytes: int = 1_048_576
    max_upload_bytes: int = 26_214_400

    # Storage
    storage_backend: Literal["local", "s3"] = "local"
    storage_root: str = "./var/files"
    s3_endpoint: str | None = None
    s3_bucket: str = "pramaansetu"
    s3_access_key: str | None = None
    s3_secret_key: str | None = None

    # LLM gateway
    llm_provider: Literal["mock", "openai_compatible"] = "mock"
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str = "mock-draft-1"
    llm_timeout_seconds: int = 30
    llm_max_retries: int = 2
    llm_breaker_failures: int = 3
    llm_breaker_reset_seconds: int = 60

    # Embeddings
    embedding_provider: Literal["local_hashing", "openai_compatible"] = "local_hashing"
    embedding_model: str = "local-hashing-1024"
    embedding_dimensions: int = 1024

    # Integration adapters (PRD 7.3, mocked in the MVP behind real interfaces)
    adapter_dpiit_mode: Literal["mock", "live"] = "mock"
    adapter_gem_mode: Literal["mock", "live"] = "mock"
    adapter_esign_mode: Literal["mock", "live"] = "mock"
    adapter_sms_mode: Literal["mock", "live"] = "mock"
    adapter_email_mode: Literal["mock", "smtp"] = "mock"

    # Workers and scheduler
    job_runner_enabled: bool = True
    job_runner_concurrency: int = 4
    scheduler_enabled: bool = True
    sla_scan_seconds: int = 300
    outbox_relay_seconds: int = 2
    job_max_attempts: int = 5
    queue_time_limits: dict[str, int] = Field(
        default_factory=lambda: {"critical": 30, "default": 60, "ai": 60, "compute": 120, "docs": 60}
    )

    # Default SLAs in days (PRD FR-PP-01), configurable per department within these limits
    sla_accept_days: int = 7
    sla_approve_days: int = 5
    sla_release_days: int = 7
    sla_reminder_fraction: float = 0.75

    # Simulation and evidence engine
    simulation_iterations: int = 10_000
    simulation_realism_factor: float = 0.7
    simulation_alpha: float = 0.05
    simulation_target_power: float = 0.80
    bootstrap_resamples: int = 10_000
    default_seed: int = 20260924
    engine_version: str = "1.0.0"

    # Feature flags for P1 work (PRD 13.4)
    feature_round_two_evaluation: bool = True
    feature_vendor_dependency_score: bool = True
    feature_context_fit_check: bool = True
    feature_daily_digest: bool = True
    feature_public_transparency: bool = True

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
