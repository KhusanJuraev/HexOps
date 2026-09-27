"""First-run owner setup: loopback only, only on an empty database, exactly once."""

import logging
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from alembic import command
from app.core.config import get_settings
from app.core.db import SessionLocal, engine
from app.main import create_app
from app.modules.auth import service
from app.modules.auth.models import User
from tests.conftest import ORIGIN, PASSWORD, _test_url

NEW_PASSWORD = "first owner passphrase"
BODY = {"username": "Owner", "password": NEW_PASSWORD, "password_confirm": NEW_PASSWORD}
BASE = "http://127.0.0.1:8000"


def make_client(host: str, origin: str | None = ORIGIN) -> TestClient:
    # Browsers always send Origin on POST; setup requires a loopback one.
    headers = {"Origin": origin} if origin else {}
    return TestClient(create_app(), base_url=BASE, client=(host, 50000), headers=headers)


@pytest.fixture
def local() -> Iterator[TestClient]:
    with make_client("127.0.0.1") as c:
        yield c


def user_rows() -> list[tuple[str, str]]:
    with SessionLocal() as db:
        return [(u.username, u.password_hash) for u in db.scalars(select(User))]


# --- empty database -----------------------------------------------------------


def test_empty_database_requires_setup_and_creates_the_owner(local, caplog):
    caplog.set_level(logging.DEBUG)
    assert local.get("/api/auth/setup").json() == {"required": True}

    res = local.post("/api/auth/setup", json=BODY, headers={"Origin": ORIGIN})
    assert res.status_code == 201, res.text
    assert res.json()["user"]["username"] == "owner"

    [(username, password_hash)] = user_rows()
    assert username == "owner"
    assert password_hash.startswith("$argon2id$")
    assert NEW_PASSWORD not in password_hash
    assert NEW_PASSWORD not in caplog.text
    assert NEW_PASSWORD not in res.text

    # Signed in straight away, and the new password works for normal login.
    assert local.get("/api/auth/me").json()["user"]["username"] == "owner"
    local.cookies.clear()
    login = local.post("/api/auth/login", json={"username": "owner", "password": NEW_PASSWORD})
    assert login.status_code == 200


def test_setup_closes_after_the_account_exists(local):
    assert local.post("/api/auth/setup", json=BODY).status_code == 201
    assert local.get("/api/auth/setup").json() == {"required": False}

    again = local.post(
        "/api/auth/setup",
        json={
            "username": "second",
            "password": "another passphrase",
            "password_confirm": "another passphrase",
        },
    )
    assert again.status_code == 409
    assert again.json()["code"] == "setup_closed"
    assert [name for name, _ in user_rows()] == ["owner"]


# --- existing account ---------------------------------------------------------


def test_existing_account_is_preserved(local, user):
    before = user_rows()
    assert local.get("/api/auth/setup").json() == {"required": False}

    res = local.post("/api/auth/setup", json={**BODY, "username": "researcher"})
    assert res.status_code == 409
    assert res.json()["code"] == "setup_closed"
    assert user_rows() == before  # same username, same hash
    ok = local.post("/api/auth/login", json={"username": "researcher", "password": PASSWORD})
    assert ok.status_code == 200


def test_migration_keeps_an_existing_account(user):
    cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    cfg.attributes["url"] = _test_url
    before = user_rows()
    command.downgrade(cfg, "0001")
    try:
        command.upgrade(cfg, "head")
    finally:
        command.upgrade(cfg, "head")
    assert user_rows() == before


def test_migration_refuses_rather_than_deleting_extra_accounts():
    cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    cfg.attributes["url"] = _test_url
    command.downgrade(cfg, "0001")
    try:
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO users (username, password_hash) VALUES ('a', 'x'), ('b', 'y')")
            )
        with pytest.raises(RuntimeError, match="allows one account"):
            command.upgrade(cfg, "head")
        assert len(user_rows()) == 2  # nothing deleted
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM users"))
        command.upgrade(cfg, "head")


# --- loopback only ------------------------------------------------------------


@pytest.mark.parametrize(
    "host", ["192.168.1.50", "10.13.4.138", "8.8.8.8", "2001:db8::1", "testclient"]
)
def test_non_loopback_client_is_denied(host):
    with make_client(host) as remote:
        res = remote.post("/api/auth/setup", json=BODY)
    assert res.status_code == 403
    assert res.json()["code"] == "setup_local_only"
    assert user_rows() == []


@pytest.mark.parametrize(
    "forwarded_for",
    [
        "192.168.1.50",  # LAN browser behind the Vite dev proxy
        "127.0.0.1, 192.168.1.50",  # client tried to spoof loopback; proxy appended the truth
        "::ffff:192.168.1.50",
    ],
)
def test_remote_client_behind_local_proxy_is_denied(local, forwarded_for):
    res = local.post("/api/auth/setup", json=BODY, headers={"X-Forwarded-For": forwarded_for})
    assert res.status_code == 403
    assert user_rows() == []


def test_rfc7239_forwarded_header_is_checked(local):
    res = local.post("/api/auth/setup", json=BODY, headers={"Forwarded": 'for="192.168.1.50"'})
    assert res.status_code == 403


@pytest.mark.parametrize("host", ["::1", "::ffff:127.0.0.1", "127.0.0.2"])
def test_loopback_variants_are_allowed(host):
    with make_client(host) as c:
        assert c.post("/api/auth/setup", json=BODY).status_code == 201


def test_local_browser_via_local_proxy_is_allowed(local):
    res = local.post("/api/auth/setup", json=BODY, headers={"X-Forwarded-For": "127.0.0.1"})
    assert res.status_code == 201


def test_uvicorn_does_not_rewrite_the_client_address_from_headers(monkeypatch):
    """Check 1 relies on request.client being the real TCP peer."""
    import app.__main__ as entry

    seen = {}
    monkeypatch.setattr(entry.uvicorn, "run", lambda *a, **kw: seen.update(kw))
    entry.main()
    assert seen["proxy_headers"] is False
    assert seen["host"] == "127.0.0.1"


def test_denial_happens_before_validation():
    with make_client("192.168.1.50") as remote:
        res = remote.post("/api/auth/setup", json={"username": "x"})
    assert res.status_code == 403  # a remote client learns nothing about the form


@pytest.mark.parametrize(
    "origin",
    [None, "https://hexops.lan", "http://192.168.1.17:5173", "http://127.0.0.1.evil.example"],
)
def test_origin_must_be_present_and_loopback(origin):
    """A LAN browser behind a proxy that drops X-Forwarded-For still sends its own Origin."""
    with make_client("127.0.0.1", origin=origin) as c:
        res = c.post("/api/auth/setup", json=BODY)
    assert res.status_code == 403
    assert user_rows() == []


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://[::1]:5173"])
def test_loopback_origins_are_accepted(origin, monkeypatch):
    monkeypatch.setenv("HEXOPS_TRUSTED_ORIGINS", origin)
    get_settings.cache_clear()
    try:
        with make_client("127.0.0.1", origin=origin) as c:
            assert c.post("/api/auth/setup", json=BODY).status_code == 201
    finally:
        monkeypatch.delenv("HEXOPS_TRUSTED_ORIGINS")
        get_settings.cache_clear()


def test_cross_site_origin_is_rejected(local):
    res = local.post("/api/auth/setup", json=BODY, headers={"Origin": "https://evil.example"})
    assert res.status_code == 403
    assert res.json()["code"] == "untrusted_origin"


# --- validation ---------------------------------------------------------------


def test_validation_is_field_level(local):
    res = local.post(
        "/api/auth/setup",
        json={"username": "a b", "password": "Pw9xq", "password_confirm": "Zk4mv"},
    )
    assert res.status_code == 422
    errors = {e["field"]: e for e in res.json()["errors"]}
    assert errors["username"]["code"] == "string_pattern_mismatch"
    assert errors["password"]["code"] == "string_too_short"
    assert errors["password"]["params"] == {"min_length": 12}
    assert "Pw9xq" not in res.text and "Zk4mv" not in res.text

    mismatch = local.post("/api/auth/setup", json={**BODY, "password_confirm": NEW_PASSWORD + "!"})
    assert [(e["field"], e["code"]) for e in mismatch.json()["errors"]] == [
        ("password_confirm", "password_mismatch")
    ]
    assert user_rows() == []


# --- concurrency --------------------------------------------------------------


def test_concurrent_http_submissions_create_exactly_one_owner():
    n = 8
    barrier = threading.Barrier(n)
    statuses: list[int] = []
    lock = threading.Lock()

    def submit(i: int) -> None:
        with make_client("127.0.0.1") as c:
            body = {
                "username": f"owner{i}",
                "password": NEW_PASSWORD,
                "password_confirm": NEW_PASSWORD,
            }
            barrier.wait()
            code = c.post("/api/auth/setup", json=body).status_code
        with lock:
            statuses.append(code)

    threads = [threading.Thread(target=submit, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sorted(statuses) == [201] + [409] * (n - 1)
    assert len(user_rows()) == 1


def test_database_blocks_a_second_owner_even_when_both_pass_the_check(monkeypatch):
    """Deterministic race: both requests see an empty table, both try to insert."""
    monkeypatch.setattr(service, "owner_exists", lambda db: False)
    with SessionLocal() as a, SessionLocal() as b:
        service.setup_owner(a, "first", NEW_PASSWORD)
        with pytest.raises(service.SetupClosed):
            service.setup_owner(b, "second", NEW_PASSWORD)
    assert [name for name, _ in user_rows()] == ["first"]


def test_single_owner_index_exists_in_the_database():
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (username, password_hash) VALUES ('a', 'x')"))
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text("INSERT INTO users (username, password_hash) VALUES ('b', 'y')"))
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(User)) == 1
