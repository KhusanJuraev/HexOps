"""Stage 7 jobs: background runner, long poll, restart recovery, expiry, cleanup (D-83)."""

import os
import time
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.core.db import SessionLocal
from app.main import create_app
from app.modules.pdf import exporter, jobs, storage
from app.modules.pdf.jobs import recover_interrupted, sweep_expired
from app.modules.pdf.models import JobKind, JobStatus, PdfJob, SourceType
from tests.pdf.conftest import export, import_pdf, text_pdf, w

ROUTES = [
    ("POST", "/api/pdf/exports"),
    ("POST", "/api/pdf/imports"),
    ("GET", "/api/pdf/jobs/1"),
    ("GET", "/api/pdf/jobs/1/download"),
    ("DELETE", "/api/pdf/jobs/1"),
]


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_every_pdf_route_requires_a_session(client, method, path):
    res = client.request(method, path)
    assert res.status_code == 401 and res.json()["code"] == "not_authenticated"


@pytest.mark.parametrize(("method", "path"), [r for r in ROUTES if r[0] != "GET"])
def test_writes_require_the_csrf_token(logged_in, method, path):
    res = logged_in.request(method, path, headers={"Origin": "http://127.0.0.1:5173"})
    assert res.status_code == 403


def test_unknown_jobs_are_not_found(logged_in):
    for method, path in [r for r in ROUTES if r[0] in ("GET", "DELETE")]:
        res = logged_in.request(method, path, headers=w(logged_in))
        assert res.status_code == 404 and res.json()["code"] == "pdf_job_not_found"


def test_status_long_polls_instead_of_needing_rapid_requests(logged_in, report, monkeypatch):
    real = exporter.html_to_pdf

    def slow(*args, **kwargs):
        time.sleep(1.5)
        return real(*args, **kwargs)

    monkeypatch.setattr(exporter, "html_to_pdf", slow)
    res = logged_in.post(
        "/api/pdf/exports",
        json={"source_type": "report", "source_id": report["id"]},
        headers=w(logged_in),
    )
    job_id = res.json()["id"]
    requests = 0
    started = time.monotonic()
    status = res.json()["status"]
    while status not in ("done", "failed"):
        status = logged_in.get(f"/api/pdf/jobs/{job_id}", params={"wait": 20}).json()["status"]
        requests += 1
    # A handful of requests for a job of several seconds: each waits for a change.
    assert status == "done"
    assert requests <= 6, requests
    assert time.monotonic() - started < 20


def test_a_quiet_long_poll_returns_after_its_wait(logged_in):
    with SessionLocal() as db:
        from app.modules.auth.models import User

        uid = db.scalar(select(User.id))
        job = PdfJob(
            kind=JobKind.import_,
            status=JobStatus.running,  # the worker never sees this row
            created_by=uid,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            warnings=[],
        )
        db.add(job)
        db.commit()
        job_id = job.id
    started = time.monotonic()
    res = logged_in.get(f"/api/pdf/jobs/{job_id}", params={"wait": 2})
    assert res.status_code == 200 and res.json()["status"] == "running"
    assert 1.8 < time.monotonic() - started < 6
    assert logged_in.get(f"/api/pdf/jobs/{job_id}", params={"wait": 26}).status_code == 422


def test_other_requests_are_served_while_a_job_runs(logged_in, report, monkeypatch):
    real = exporter.html_to_pdf

    def slow(*args, **kwargs):
        time.sleep(3)
        return real(*args, **kwargs)

    monkeypatch.setattr(exporter, "html_to_pdf", slow)
    job_id = logged_in.post(
        "/api/pdf/exports",
        json={"source_type": "report", "source_id": report["id"]},
        headers=w(logged_in),
    ).json()["id"]
    started = time.monotonic()
    assert logged_in.get("/api/reports").status_code == 200
    assert logged_in.get("/api/health").status_code == 200
    assert time.monotonic() - started < 1.5  # not stuck behind the export
    job = logged_in.get(f"/api/pdf/jobs/{job_id}").json()
    assert job["status"] in ("queued", "running")


def test_jobs_left_unfinished_by_a_crash_fail_on_the_next_start(logged_in, pdf_dir):
    """Simulates a restart: rows say queued/running, no worker is processing them."""
    with SessionLocal() as db:
        from app.modules.auth.models import User

        uid = db.scalar(select(User.id))
        leftover = storage.save_bytes(text_pdf(["half-read upload"]))
        tmp = storage.temp_path()
        tmp.write_bytes(b"partial")
        running = PdfJob(
            kind=JobKind.import_,
            status=JobStatus.running,
            progress=40,
            created_by=uid,
            input_name=leftover,
            original_name="big.pdf",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            warnings=[],
        )
        queued = PdfJob(
            kind=JobKind.export,
            status=JobStatus.queued,
            created_by=uid,
            source_type=SourceType.report,
            source_id=1,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            warnings=[],
        )
        db.add_all([running, queued])
        db.commit()
        ids = (running.id, queued.id)

    with TestClient(create_app(), base_url="http://127.0.0.1:8000"):  # startup runs recovery
        pass

    for job_id in ids:
        job = logged_in.get(f"/api/pdf/jobs/{job_id}").json()
        assert job["status"] == "failed" and job["error_code"] == "pdf_job_interrupted"
        assert job["finished_at"] is not None
    assert list(pdf_dir.iterdir()) == []  # the half-read upload and temp file are gone
    assert recover_interrupted() == 0  # nothing left to recover


def test_finished_jobs_expire_with_their_files(logged_in, report, pdf_dir):
    job = export(logged_in, "report", report["id"])
    assert len(list(pdf_dir.iterdir())) == 1
    assert sweep_expired() == 0  # not expired yet
    with SessionLocal() as db:
        db.execute(update(PdfJob).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        db.commit()
    assert sweep_expired() == 1
    assert list(pdf_dir.iterdir()) == []
    assert logged_in.get(f"/api/pdf/jobs/{job['id']}").status_code == 404
    assert logged_in.get(f"/api/pdf/jobs/{job['id']}/download").status_code == 404


def test_a_missing_result_file_is_gone_not_an_error(logged_in, report, pdf_dir):
    job = export(logged_in, "report", report["id"])
    for path in pdf_dir.iterdir():
        path.unlink()
    res = logged_in.get(f"/api/pdf/jobs/{job['id']}/download")
    assert res.status_code == 410 and res.json()["code"] == "pdf_job_expired"


def test_orphaned_and_temporary_files_are_swept(pdf_dir):
    orphan = storage.save_bytes(b"%PDF-1.4 nobody refers to me")
    tmp = storage.temp_path()
    tmp.write_bytes(b"partial")
    fresh = storage.save_bytes(b"%PDF-1.4 just written")
    old = time.time() - 7200
    for path in (storage.path_for(orphan), tmp):
        os.utime(path, (old, old))
    sweep_expired()
    assert [p.name for p in pdf_dir.iterdir()] == [fresh]  # recent files are left alone


def test_deleting_a_job_discards_its_result(logged_in, report, pdf_dir):
    job = export(logged_in, "report", report["id"])
    res = logged_in.delete(f"/api/pdf/jobs/{job['id']}", headers=w(logged_in))
    assert res.status_code == 204
    assert list(pdf_dir.iterdir()) == []
    assert logged_in.get(f"/api/pdf/jobs/{job['id']}").status_code == 404


def test_a_failed_export_leaves_no_files(logged_in, report, pdf_dir, monkeypatch):
    def broken(*_args, **_kwargs):
        raise exporter.ExportFailed("pdf_export_failed")

    monkeypatch.setattr(exporter, "html_to_pdf", broken)
    job = export(logged_in, "report", report["id"])
    assert job["status"] == "failed" and job["error_code"] == "pdf_export_failed"
    assert list(pdf_dir.iterdir()) == []


def test_a_failure_while_saving_the_result_removes_the_temporary_file(
    logged_in, report, pdf_dir, monkeypatch
):
    def full_disk(_src, _dst):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(storage.os, "replace", full_disk)
    job = export(logged_in, "report", report["id"])
    assert job["status"] == "failed" and job["error_code"] == "pdf_export_failed"
    assert list(pdf_dir.iterdir()) == []


def test_an_unexpected_error_fails_the_job_without_logging_content(
    logged_in, report, monkeypatch, caplog
):
    def boom(*_args, **_kwargs):
        raise RuntimeError("renderer exploded")

    monkeypatch.setattr(exporter, "html_to_pdf", boom)
    job = export(logged_in, "report", report["id"])
    assert job["status"] == "failed" and job["error_code"] == "pdf_export_failed"
    assert "' OR 1=1" not in caplog.text and report["title"] not in caplog.text


def test_an_export_whose_record_was_deleted_meanwhile_fails(logged_in):
    with SessionLocal() as db:
        from app.modules.auth.models import User

        job = PdfJob(
            kind=JobKind.export,
            created_by=db.scalar(select(User.id)),
            source_type=SourceType.note,
            source_id=12345,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            warnings=[],
        )
        db.add(job)
        db.commit()
        job_id = job.id
    jobs.run_job(job_id)
    job = logged_in.get(f"/api/pdf/jobs/{job_id}").json()
    assert job["status"] == "failed" and job["error_code"] == "pdf_source_not_found"


def test_too_many_waiting_jobs_are_refused(logged_in, report):
    with SessionLocal() as db:
        from app.modules.auth.models import User

        uid = db.scalar(select(User.id))
        db.add_all(
            PdfJob(
                kind=JobKind.import_,
                status=JobStatus.queued,
                created_by=uid,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
                warnings=[],
            )
            for _ in range(10)
        )
        db.commit()
    res = logged_in.post(
        "/api/pdf/exports",
        json={"source_type": "report", "source_id": report["id"]},
        headers=w(logged_in),
    )
    assert res.status_code == 429 and res.json()["code"] == "pdf_queue_full"


def test_an_import_job_never_touches_existing_records(logged_in, report, note):
    before_r = logged_in.get(f"/api/reports/{report['id']}").json()
    before_n = logged_in.get(f"/api/notes/{note['id']}").json()
    import_pdf(logged_in, text_pdf([before_r["title"]]))
    assert logged_in.get(f"/api/reports/{report['id']}").json() == before_r
    assert logged_in.get(f"/api/notes/{note['id']}").json() == before_n


def test_the_job_files_directory_is_private(logged_in, report, pdf_dir):
    export(logged_in, "report", report["id"])
    assert pdf_dir.stat().st_mode & 0o077 == 0
    for path in pdf_dir.iterdir():
        assert path.stat().st_mode & 0o077 == 0


def test_the_ui_reads_the_configured_limits(logged_in, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "pdf_import_max_bytes", 5 * 1024 * 1024)
    monkeypatch.setattr(get_settings(), "pdf_import_max_pages", 30)
    monkeypatch.setattr(get_settings(), "max_upload_bytes", 7 * 1024 * 1024)
    assert logged_in.get("/api/pdf/limits").json() == {
        "max_bytes": 5 * 1024 * 1024,
        "max_pages": 30,
    }
    assert logged_in.get("/api/reports/evidence-limits").json() == {
        "max_bytes": 7 * 1024 * 1024,
        "max_files": get_settings().max_attachments_per_report,
    }
