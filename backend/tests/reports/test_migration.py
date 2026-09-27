"""Migration 0004 (reports, evidence, activity actor) runs down and up cleanly."""

from pathlib import Path

from alembic.config import Config
from sqlalchemy import inspect, select

from alembic import command
from app.core.db import SessionLocal, engine
from app.modules.auth.models import User
from tests.conftest import _test_url

TABLES = {"reports", "report_attachments"}


def _cfg() -> Config:
    cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    cfg.attributes["url"] = _test_url
    return cfg


def test_down_to_0003_and_back_keeps_projects_and_the_account(logged_in):
    from tests.reports.conftest import w

    pid = logged_in.post(
        "/api/projects", json={"name": "Kept", "type": "bounty_program"}, headers=w(logged_in)
    ).json()["id"]
    command.downgrade(_cfg(), "0003")
    try:
        names = set(inspect(engine).get_table_names())
        assert not TABLES & names and "projects" in names
        assert "actor_user_id" not in {
            c["name"] for c in inspect(engine).get_columns("activity_logs")
        }
    finally:
        command.upgrade(_cfg(), "head")
    assert TABLES <= set(inspect(engine).get_table_names())
    with SessionLocal() as db:
        assert db.scalar(select(User.username)) == "researcher"
    assert logged_in.get(f"/api/projects/{pid}").json()["name"] == "Kept"


def test_report_constraints_exist():
    checks = {c["name"] for c in inspect(engine).get_check_constraints("reports")}
    assert checks == {
        "ck_reports_report_type",
        "ck_reports_severity",
        "ck_reports_report_status",
        "ck_reports_cvss_score_range",
        "ck_reports_bounty_amount_positive",
        "ck_reports_bounty_currency_iso",
        "ck_reports_bounty_amount_currency",
        "ck_reports_paid_only_bbp",
    }
    fks = {
        f["referred_table"]: f["options"].get("ondelete")
        for f in inspect(engine).get_foreign_keys("reports")
    }
    assert fks == {"projects": "RESTRICT"}
    att = {
        f["referred_table"]: f["options"].get("ondelete")
        for f in inspect(engine).get_foreign_keys("report_attachments")
    }
    assert att == {"reports": "CASCADE"}
