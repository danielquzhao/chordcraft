"""Supabase auth: token checks and per-user scores, with locally signed tokens."""

import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app import auth
from app.auth import AuthConfig, get_auth_config
from app.main import app

SECRET = "test-secret-at-least-32-bytes-long!!"
ALICE, BOB = "11111111-aaaa-aaaa-aaaa-111111111111", "22222222-bbbb-bbbb-bbbb-222222222222"
BLANK = {"score": None}


def token(
    sub: str, *, secret: str = SECRET, expires_in: int = 3600, aud: str = "authenticated"
) -> str:
    now = int(time.time())
    return jwt.encode(
        {"sub": sub, "aud": aud, "iat": now, "exp": now + expires_in}, secret, "HS256"
    )


def as_user(sub: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token(sub)}"}


@pytest.fixture
def secret_auth():
    app.dependency_overrides[get_auth_config] = lambda: AuthConfig(jwt_secret=SECRET)
    yield
    app.dependency_overrides.pop(get_auth_config, None)


async def test_requests_need_a_valid_token(client, secret_auth):
    assert (await client.get("/scores")).status_code == 401
    bad = {"Authorization": f"Bearer {token(ALICE, secret='x' * 40)}"}
    assert (await client.get("/scores", headers=bad)).status_code == 401
    expired = {"Authorization": f"Bearer {token(ALICE, expires_in=-60)}"}
    res = await client.get("/scores", headers=expired)
    assert res.status_code == 401 and "expired" in res.json()["detail"]["message"]
    wrong_audience = {"Authorization": f"Bearer {token(ALICE, aud='anon')}"}
    assert (await client.get("/scores", headers=wrong_audience)).status_code == 401
    assert (await client.get("/scores", headers=as_user(ALICE))).status_code == 200
    # Health stays public for uptime checks.
    assert (await client.get("/health")).status_code == 200


async def test_scores_belong_to_their_creator(client, secret_auth):
    mine = (await client.post("/scores", json=BLANK, headers=as_user(ALICE))).json()
    sid = mine["id"]

    assert [s["id"] for s in (await client.get("/scores", headers=as_user(ALICE))).json()] == [sid]
    assert (await client.get("/scores", headers=as_user(BOB))).json() == []

    # To anyone else it looks missing, for reading and for writing.
    for method, path, body in [
        ("GET", f"/scores/{sid}", None),
        ("GET", f"/scores/{sid}/history", None),
        ("GET", f"/scores/{sid}/messages", None),
        (
            "POST",
            f"/scores/{sid}/revisions",
            {"base": 1, "ops": [{"op": "set_chord", "measure": 1, "chord": "G"}]},
        ),
        (
            "POST",
            f"/scores/{sid}/edits",
            {"instruction": "x", "selection": {"start": 1, "end": 1}, "base": 1},
        ),
        ("DELETE", f"/scores/{sid}", None),
    ]:
        res = await client.request(method, path, json=body, headers=as_user(BOB))
        assert res.status_code == 404, (method, path, res.status_code)

    assert (await client.get(f"/scores/{sid}", headers=as_user(ALICE))).status_code == 200


async def test_edit_jobs_follow_their_score(client, secret_auth):
    sid = (await client.post("/scores", json=BLANK, headers=as_user(ALICE))).json()["id"]
    job = (
        await client.post(
            f"/scores/{sid}/edits",
            json={"instruction": "x", "selection": {"start": 1, "end": 1}, "base": 1},
            headers=as_user(ALICE),
        )
    ).json()
    assert (await client.get(f"/edits/{job['id']}", headers=as_user(BOB))).status_code == 404
    assert (
        await client.post(f"/edits/{job['id']}/reject", headers=as_user(BOB))
    ).status_code == 404
    # EventSource can't send headers: the stream takes the token as a query parameter.
    res = await client.post(f"/edits/{job['id']}/reject", headers=as_user(ALICE))
    assert res.status_code == 204
    stream = await client.get(f"/edits/{job['id']}/events?access_token={token(ALICE)}")
    assert stream.status_code == 200 and '"status": "rejected"' in stream.text
    assert (await client.get(f"/edits/{job['id']}/events")).status_code == 401


async def test_project_signing_keys(client, monkeypatch):
    """Projects on Supabase's asymmetric signing keys: verify against the JWKS."""
    key = ec.generate_private_key(ec.SECP256R1())
    jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(key.public_key()))

    class FakeJwks:
        def get_signing_key_from_jwt(self, _token):
            return jwt.PyJWK({**jwk, "kid": "k1", "alg": "ES256"})

    monkeypatch.setattr(auth, "_jwks", lambda url: FakeJwks())
    app.dependency_overrides[get_auth_config] = lambda: AuthConfig(
        supabase_url="https://x.supabase.co"
    )
    try:
        now = int(time.time())
        signed = jwt.encode(
            {"sub": ALICE, "aud": "authenticated", "exp": now + 60},
            key,
            "ES256",
            headers={"kid": "k1"},
        )
        res = await client.get("/scores", headers={"Authorization": f"Bearer {signed}"})
        assert res.status_code == 200
        # A token signed with the old shared secret is not accepted by a JWKS project.
        assert (await client.get("/scores", headers=as_user(ALICE))).status_code == 401
    finally:
        app.dependency_overrides.pop(get_auth_config, None)


async def test_without_supabase_settings_everything_is_open(client):
    sid = (await client.post("/scores", json=BLANK)).json()["id"]
    assert (await client.get(f"/scores/{sid}")).status_code == 200
