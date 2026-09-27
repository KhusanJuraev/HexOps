"""python -m app.modules.transfer.cli export: the export the uninstaller offers before a purge."""

import io
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

from app.modules.transfer import cli
from tests.transfer.conftest import PASSPHRASE, check, fill


def run(monkeypatch, path, stdin: str) -> None:
    monkeypatch.setattr("sys.stdin", io.StringIO(stdin))
    cli.main(["export", str(path)])


def test_cli_export_is_a_normal_encrypted_export(logged_in, monkeypatch, tmp_path, capsys):
    fill(logged_in)
    target = tmp_path / "before-uninstall.hexops"
    run(monkeypatch, target, f"{PASSPHRASE}\n{PASSPHRASE}\n")

    out = capsys.readouterr().out
    assert PASSPHRASE not in out
    assert "Saved" in out and "evidence file(s)" in out
    assert stat.S_IMODE(os.stat(target).st_mode) == 0o600
    assert not list(tmp_path.glob("*.partial"))
    # The web import accepts it and sees the same workspace.
    job = check(logged_in, target.read_bytes())
    assert job["status"] == "validated", job
    assert job["preview"]["source"]["counts"]["reports"] == 2
    assert job["preview"]["source"]["files"] >= 1


@pytest.mark.parametrize(
    ("stdin", "message"),
    [
        ("short\nshort\n", "must be 12-1024 characters"),
        (f"{PASSPHRASE}\n{PASSPHRASE} typo\n", "do not match"),
    ],
)
def test_cli_export_refuses_bad_passphrases(user, monkeypatch, tmp_path, stdin, message):
    target = tmp_path / "x.hexops"
    with pytest.raises(SystemExit) as e:
        run(monkeypatch, target, stdin)
    assert message in str(e.value.code)
    assert not target.exists()


def test_cli_export_never_overwrites(user, monkeypatch, tmp_path):
    target = tmp_path / "x.hexops"
    target.write_bytes(b"keep me")
    with pytest.raises(SystemExit) as e:
        run(monkeypatch, target, f"{PASSPHRASE}\n{PASSPHRASE}\n")
    assert "never overwritten" in str(e.value.code)
    assert target.read_bytes() == b"keep me"


def test_cli_export_runs_as_its_own_process(logged_in, tmp_path):
    """As the uninstaller runs it: a fresh interpreter (the table registry must load)."""
    assert os.environ["HEXOPS_DATABASE_URL"] != ""  # the test database (tests/conftest.py)
    fill(logged_in)
    target = tmp_path / "standalone.hexops"
    res = subprocess.run(  # noqa: S603 - fixed arguments
        [sys.executable, "-m", "app.modules.transfer.cli", "export", str(target)],
        cwd=Path(__file__).resolve().parents[2],
        input=f"{PASSPHRASE}\n{PASSPHRASE}\n",
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert res.returncode == 0, res.stderr
    assert PASSPHRASE not in res.stdout + res.stderr
    job = check(logged_in, target.read_bytes())
    assert job["status"] == "validated", job
