from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://chordcraft:chordcraft@localhost:5433/chordcraft"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: list[str] = ["http://localhost:5173"]

    # Filled in at M3 (agent) and M6 (auth).
    anthropic_api_key: str = ""
    supabase_url: str = ""
    supabase_jwt_secret: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
