"""Account management CLI: the documented password-recovery path."""

import pytest
from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.modules.auth import cli
from app.modules.auth.models import User, UserSession
from tests.conftest import PASSWORD

NEW_PASSWORD = "a brand new passphrase"


def feed_passwords(monkeypatch, *answers: str) -> None:
    it = iter(answers)
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": next(it))


def login(client, password: str) -> int:
    res = client.post("/api/auth/login", json={"username": "researcher", "password": password})
    return res.status_code


def session_count() -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(UserSession))


def test_set_password_resets_password_and_revokes_sessions(logged_in, monkeypatch, capsys):
    old_cookie = logged_in.cookies["hexops_session"]
    feed_passwords(monkeypatch, NEW_PASSWORD, NEW_PASSWORD)

    cli.main(["set-password", "Researcher"])

    assert "Password updated for 'researcher'" in capsys.readouterr().out
    assert session_count() == 0
    logged_in.cookies.set("hexops_session", old_cookie)
    assert logged_in.get("/api/auth/me").status_code == 401
    logged_in.cookies.clear()
    assert login(logged_in, PASSWORD) == 401
    assert login(logged_in, NEW_PASSWORD) == 200


def test_password_never_printed(user, monkeypatch, capsys):
    feed_passwords(monkeypatch, NEW_PASSWORD, NEW_PASSWORD)
    cli.main(["set-password", "researcher"])
    captured = capsys.readouterr()
    assert NEW_PASSWORD not in captured.out + captured.err


@pytest.mark.parametrize(
    ("answers", "message"),
    [
        ((NEW_PASSWORD, "something else entirely"), "do not match"),
        (("short",), "must be 12-256"),
    ],
)
def test_set_password_rejects_bad_input_and_keeps_old_password(
    client, user, monkeypatch, answers, message
):
    feed_passwords(monkeypatch, *answers)
    with pytest.raises(SystemExit) as exc:
        cli.main(["set-password", "researcher"])
    assert message in str(exc.value)
    assert login(client, PASSWORD) == 200


def test_set_password_unknown_user(user, monkeypatch):
    feed_passwords(monkeypatch, NEW_PASSWORD, NEW_PASSWORD)
    with pytest.raises(SystemExit, match="No user named 'ghost'"):
        cli.main(["set-password", "ghost"])


def test_invalid_username_is_rejected_before_prompting(monkeypatch):
    feed_passwords(monkeypatch)  # any prompt would raise StopIteration
    with pytest.raises(SystemExit, match="Username must be"):
        cli.main(["set-password", "../etc"])


def test_create_user_then_refuses_a_second(client, monkeypatch):
    feed_passwords(monkeypatch, PASSWORD, PASSWORD)
    cli.main(["create-user", "Researcher"])
    assert login(client, PASSWORD) == 200

    feed_passwords(monkeypatch, PASSWORD, PASSWORD)
    with pytest.raises(SystemExit, match="single-user"):
        cli.main(["create-user", "second"])
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(User)) == 1
