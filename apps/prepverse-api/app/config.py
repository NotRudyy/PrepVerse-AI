import os
from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="PREPVERSE_", extra="ignore")

    # A persistent local database keeps sign-up available without requiring Docker.
    # compose.yaml overrides this with PostgreSQL for container deployments.
    database_url: str = "sqlite:///./var/prepverse.db"
    jwt_secret: str = Field(min_length=32)
    web_origin: str = "http://localhost:3001"
    api_origin: str = "http://localhost:8001"
    cookie_secure: bool = False
    google_client_id: str | None = None
    google_client_secret: str | None = None
    github_client_id: str | None = None
    github_client_secret: str | None = None
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.8-flash"
    max_upload_bytes: int = Field(default_factory=lambda: 4 * 1024 * 1024 if os.environ.get("VERCEL") else 20 * 1024 * 1024)
    cookie_name: str = "prepverse_session"

    @model_validator(mode="after")
    def enforce_serverless_upload_limit(self) -> "Settings":
        if os.environ.get("VERCEL"):
            self.max_upload_bytes = min(self.max_upload_bytes, 4 * 1024 * 1024)
        return self

@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
