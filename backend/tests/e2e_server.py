"""Start the API on a freshly wiped, disposable database for browser (E2E) tests.

    python -m tests.e2e_server      # used by frontend/playwright.config.ts

Needs HEXOPS_E2E_DATABASE_URL, which must differ from the dev and pytest databases.
Everything in that database is deleted on every start.
"""

import os
import shutil
from pathlib import Path

from dotenv import dotenv_values

BACKEND_DIR = Path(__file__).resolve().parent.parent
E2E_USERNAME = "e2e"
E2E_PASSWORD = "e2e password for disposable db"  # noqa: S105 - throwaway loopback test DB


def main() -> None:
    env = {**dotenv_values(BACKEND_DIR / ".env"), **os.environ}
    url = env.get("HEXOPS_E2E_DATABASE_URL")
    if not url:
        raise SystemExit("Set HEXOPS_E2E_DATABASE_URL (backend/.env) to run E2E tests.")
    if url in (env.get("HEXOPS_DATABASE_URL"), env.get("HEXOPS_TEST_DATABASE_URL")):
        raise SystemExit("HEXOPS_E2E_DATABASE_URL must be a separate, disposable database.")
    os.environ["HEXOPS_DATABASE_URL"] = url
    os.environ["HEXOPS_HOST"] = "127.0.0.1"
    # Throwaway evidence and PDF job directories, wiped on every start like the database.
    uploads = BACKEND_DIR.parent / "data" / "e2e-uploads"
    shutil.rmtree(uploads, ignore_errors=True)
    os.environ["HEXOPS_UPLOADS_DIR"] = str(uploads)
    pdf_jobs = BACKEND_DIR.parent / "data" / "e2e-pdf-jobs"
    shutil.rmtree(pdf_jobs, ignore_errors=True)
    os.environ["HEXOPS_PDF_DIR"] = str(pdf_jobs)
    for name, var in (
        ("e2e-transfer", "HEXOPS_TRANSFER_DIR"),
        ("e2e-backups", "HEXOPS_BACKUPS_DIR"),
    ):
        path = BACKEND_DIR.parent / "data" / name
        shutil.rmtree(path, ignore_errors=True)
        os.environ[var] = str(path)
    port = int(env.get("HEXOPS_E2E_API_PORT") or 8001)

    import uvicorn
    from alembic.config import Config
    from sqlalchemy import text

    from alembic import command
    from app.core.db import SessionLocal, engine
    from app.modules.auth.service import create_user

    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.attributes["url"] = url
    command.upgrade(cfg, "head")
    with SessionLocal() as db:
        create_user(db, E2E_USERNAME, E2E_PASSWORD)

    uvicorn.run("app.main:app", host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
