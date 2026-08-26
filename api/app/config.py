from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# api/.env, wherever the process was started from (the server, worker and CLI all use it).
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    database_url: str = "postgresql+asyncpg://chordcraft:chordcraft@localhost:5433/chordcraft"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: list[str] = ["http://localhost:5173"]

    @field_validator("database_url")
    @classmethod
    def _asyncpg_url(cls, url: str) -> str:
        return asyncpg_url(url)

    # Agent (M3). The SDK also reads ANTHROPIC_API_KEY from the environment.
    anthropic_api_key: str = ""
    agent_model: str = "claude-sonnet-5-5"  # or a gemini-* model id
    agent_effort: str = "medium"
    # Tab autocomplete: one quick call per suggestion, so keep thinking light.
    suggest_effort: str = "low"
    # Gemini (optional). The google-genai SDK also reads GEMINI_API_KEY / GOOGLE_API_KEY.
    gemini_api_key: str = ""

    # Auth: set SUPABASE_URL to require sign-in (tokens checked against the project's JWKS).
    # SUPABASE_JWT_SECRET is only for projects still on the legacy shared JWT secret.
    supabase_url: str = ""
    supabase_jwt_secret: str = ""


def asyncpg_url(url: str) -> str:
    """Accept the plain URLs hosting providers hand out (Railway, Supabase, Render).

    `postgres://` / `postgresql://` become `postgresql+asyncpg://`, and libpq's `sslmode`
    becomes asyncpg's `ssl`.
    """
    parts = urlsplit(url)
    scheme = parts.scheme
    if scheme in ("postgres", "postgresql"):
        scheme = "postgresql+asyncpg"
    query = [("ssl" if k == "sslmode" else k, v) for k, v in parse_qsl(parts.query)]
    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


@lru_cache
def get_settings() -> Settings:
    return Settings()
