import pytest

from app.config import asyncpg_url


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("postgres://u:p@host:5432/db", "postgresql+asyncpg://u:p@host:5432/db"),
        (
            "postgresql://u:p@db.x.supabase.co:5432/postgres?sslmode=require",
            "postgresql+asyncpg://u:p@db.x.supabase.co:5432/postgres?ssl=require",
        ),
        (
            "postgresql+asyncpg://u:p@localhost:5433/db",
            "postgresql+asyncpg://u:p@localhost:5433/db",
        ),
    ],
)
def test_asyncpg_url(given, expected):
    assert asyncpg_url(given) == expected
