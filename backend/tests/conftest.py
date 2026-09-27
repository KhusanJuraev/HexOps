import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from dotenv import dotenv_values

# Point the app at the test database *before* anything imports app.core.db.
_env = {**dotenv_values(Path(__file__).resolve().parent.parent / ".env"), **os.environ}
_test_url = _env.get("HEXOPS_TEST_DATABASE_URL")
if not _test_url:
    raise RuntimeError("Set HEXOPS_TEST_DATABASE_URL (backend/.env) to run the tests.")
if _test_url == _env.get("HEXOPS_DATABASE_URL"):
    raise RuntimeError("HEXOPS_TEST_DATABASE_URL must differ from HEXOPS_DATABASE_URL.")
os.environ["HEXOPS_DATABASE_URL"] = _test_url
# Evidence files go to a throwaway directory, never to the real data/uploads.
os.environ["HEXOPS_UPLOADS_DIR"] = tempfile.mkdtemp(prefix="hexops-test-uploads-")
# PDF job files (Stage 7) likewise.
os.environ["HEXOPS_PDF_DIR"] = tempfile.mkdtemp(prefix="hexops-test-pdf-")
# Full-data transfer working files and pre-import backups (D-90) likewise.
os.environ["HEXOPS_TRANSFER_DIR"] = tempfile.mkdtemp(prefix="hexops-test-transfer-")
os.environ["HEXOPS_BACKUPS_DIR"] = tempfile.mkdtemp(prefix="hexops-test-backups-")

from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from alembic import command  # noqa: E402
from app.core.db import SessionLocal, engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Base  # noqa: E402
from app.modules.auth.service import create_user, login_throttle  # noqa: E402

PASSWORD = "correct horse battery staple"
ORIGIN = "http://127.0.0.1:5173"


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    """Build the schema through Alembic so the migrations themselves are tested."""
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
    cfg = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
    cfg.attributes["url"] = _test_url
    command.upgrade(cfg, "head")


@pytest.fixture(autouse=True)
def clean_tables() -> Iterator[None]:
    yield
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    login_throttle.reset()


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as c:
        yield c


@pytest.fixture
def user():
    with SessionLocal() as db:
        return create_user(db, "Researcher", PASSWORD)


@pytest.fixture
def logged_in(client: TestClient, user) -> TestClient:
    res = client.post("/api/auth/login", json={"username": "researcher", "password": PASSWORD})
    assert res.status_code == 200, res.text
    return client
