from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# api/.env, wherever the process was started from (the server, worker and CLI all use it).
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    database_url: str = "postgresql+asyncpg://chordcraft:chordcraft@localhost:5433/chordcraft"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: list[str] = ["http://localhost:5173"]

    # Agent (M3). The SDK also reads ANTHROPIC_API_KEY from the environment.
    anthropic_api_key: str = ""
    agent_model: str = "claude-sonnet-5-5"  # or a gemini-* model id
    agent_effort: str = "medium"
    # Gemini (optional). The google-genai SDK also reads GEMINI_API_KEY / GOOGLE_API_KEY.
    gemini_api_key: str = ""

    # Auth (M6).
    supabase_url: str = ""
    supabase_jwt_secret: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
