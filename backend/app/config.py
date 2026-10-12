from __future__ import annotations

import logging
from functools import lru_cache

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger("f1z.config")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = "development"  # development | production | test
    dev_mode: bool = False

    database_url: str = "postgresql+asyncpg://f1z:f1z@localhost:5432/f1z"

    bot_token: str = ""
    bot_username: str = ""
    webapp_url: str = "http://localhost:5173"
    owner_telegram_id: int = 5102543442  # project owner, always receives admin notifications
    admin_telegram_ids: str = ""  # comma separated ids that receive notifications

    secret_key: str = "change-me-please-use-a-long-random-string"
    # Key for encrypting inventory secrets (base64, 32 bytes). Derived from SECRET_KEY when empty.
    inventory_key: str = ""
    # SMS-activation provider (sms-activate.org). Key lives only in .env on the server, never in git.
    sms_activate_api_key: str = ""
    sms_activate_base_url: str = "https://api.sms-activate.org/stubs/handler_api.php"
    admin_username: str = "admin"
    admin_password: str = ""  # plain (dev) — prefer ADMIN_PASSWORD_HASH in production
    admin_password_hash: str = ""  # pbkdf2_sha256:iterations:salt:hash
    admin_token_ttl_hours: int = 12

    init_data_ttl_seconds: int = 86400
    order_ttl_minutes: int = 30
    max_pending_orders: int = 5

    dev_user_id: int = 100000001
    cors_origins: str = "http://localhost:5173,http://localhost:5174"
    log_level: str = "INFO"
    run_background_tasks: bool = True

    @field_validator("environment")
    @classmethod
    def _env(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in {"development", "production", "test"}:
            raise ValueError("ENVIRONMENT must be development, production or test")
        return v

    @model_validator(mode="after")
    def _production_guards(self) -> "Settings":
        if self.environment == "production":
            if self.dev_mode:
                log.warning("DEV_MODE forcibly disabled because ENVIRONMENT=production")
                self.dev_mode = False
            if self.secret_key.startswith("change-me") or len(self.secret_key) < 32:
                raise ValueError("SECRET_KEY must be a random string (>=32 chars) in production")
            if not self.admin_password_hash and len(self.admin_password) < 10:
                raise ValueError("Set ADMIN_PASSWORD_HASH (or ADMIN_PASSWORD >= 10 chars) in production")
            if not self.bot_token:
                raise ValueError("BOT_TOKEN is required in production")
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def admin_ids(self) -> list[int]:
        ids = [int(x) for x in self.admin_telegram_ids.replace(" ", "").split(",") if x]
        if self.owner_telegram_id and self.owner_telegram_id not in ids:
            ids.insert(0, self.owner_telegram_id)
        return ids

    @property
    def cors_list(self) -> list[str]:
        return [x.strip() for x in self.cors_origins.split(",") if x.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
