"""Migration 0003 (projects, scope items, activity log) runs down and up cleanly."""

from pathlib import Path

from alembic.config import Config
from sqlalchemy import inspect, select

from alembic import command
from app.core.db import SessionLocal, engine
from app.modules.auth.models import User
from tests.conftest import _test_url

TABLES = {"projects", "project_scope_items", "activity_logs"}


def _cfg() -> Config:
    cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    cfg.attributes["url"] = _test_url
    return cfg


def _tables() -> set[str]:
    return set(inspect(engine).get_table_names())


def test_downgrade_and_upgrade_keep_the_account(user):
    command.downgrade(_cfg(), "0002")
    try:
        assert not TABLES & _tables()
        with SessionLocal() as db:
            assert db.scalar(select(User.username)) == "researcher"
    finally:
        command.upgrade(_cfg(), "head")
    assert TABLES <= _tables()
    with SessionLocal() as db:
        assert db.scalar(select(User.username)) == "researcher"


def test_schema_matches_the_models():
    command.check(_cfg())  # raises if autogenerate would emit any operation


def test_constraints_are_named_once():
    checks = {c["name"] for c in inspect(engine).get_check_constraints("projects")}
    assert checks == {"ck_projects_project_type", "ck_projects_project_status"}
    kinds = {c["name"] for c in inspect(engine).get_check_constraints("project_scope_items")}
    assert kinds == {"ck_project_scope_items_scope_kind"}
    fks = inspect(engine).get_foreign_keys("project_scope_items")
    assert [(f["referred_table"], f["options"].get("ondelete")) for f in fks] == [
        ("projects", "CASCADE")
    ]
    assert inspect(engine).get_foreign_keys("activity_logs") == []  # history outlives projects
