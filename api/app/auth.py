"""Supabase authentication.

Auth is on when SUPABASE_URL (or SUPABASE_JWT_SECRET) is set. Requests then need a Supabase
access token, as `Authorization: Bearer <token>` or, for EventSource streams which can't send
headers, an `access_token` query parameter. Tokens are verified with the project's published
signing keys (JWKS), or with the legacy shared secret when SUPABASE_JWT_SECRET is set.

With auth off (local development) every request is the anonymous local user, and scores
aren't filtered by owner.
"""

from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool

from app.config import get_settings

AUDIENCE = "authenticated"


@dataclass(frozen=True)
class AuthConfig:
    supabase_url: str = ""
    jwt_secret: str = ""

    @property
    def enabled(self) -> bool:
        return bool(self.supabase_url or self.jwt_secret)


@dataclass(frozen=True)
class User:
    """`id` is the Supabase user id, or None when auth is off."""

    id: str | None


def get_auth_config() -> AuthConfig:
    s = get_settings()
    return AuthConfig(supabase_url=s.supabase_url.rstrip("/"), jwt_secret=s.supabase_jwt_secret)


@lru_cache
def _jwks(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json", cache_keys=True)


def _unauthorized(message: str) -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        detail={"code": "unauthorized", "message": message},
        headers={"WWW-Authenticate": "Bearer"},
    )


def _token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return request.query_params.get("access_token")


async def verify(token: str, config: AuthConfig) -> dict[str, Any]:
    try:
        if config.jwt_secret:
            return jwt.decode(token, config.jwt_secret, algorithms=["HS256"], audience=AUDIENCE)
        # Fetching/caching the signing keys is blocking I/O; keep it off the event loop.
        key = await run_in_threadpool(_jwks(config.supabase_url).get_signing_key_from_jwt, token)
        return jwt.decode(token, key.key, algorithms=["ES256", "RS256"], audience=AUDIENCE)
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Your session has expired. Sign in again.") from None
    except (jwt.InvalidTokenError, jwt.PyJWKClientError):
        raise _unauthorized("Sign in to continue.") from None


async def current_user(
    request: Request, config: Annotated[AuthConfig, Depends(get_auth_config)]
) -> User:
    if not config.enabled:
        return User(id=None)
    token = _token(request)
    if not token:
        raise _unauthorized("Sign in to continue.")
    claims = await verify(token, config)
    subject = claims.get("sub")
    if not subject:
        raise _unauthorized("Sign in to continue.")
    return User(id=str(subject))


CurrentUser = Annotated[User, Depends(current_user)]
