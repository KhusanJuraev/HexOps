"""Full-data export/import (D-90), on the disposable test database and temp directories."""

import hashlib
import io
import json
import logging
import os
import zipfile
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.core import maintenance
from app.core.config import get_settings
from app.core.db import SessionLocal, engine
from app.main import create_app
from app.modules.auth.models import User
from app.modules.transfer import archive, container, jobs, storage
from app.modules.transfer.models import TransferJob, TransferKind, TransferStatus
from tests.conftest import PASSWORD
from tests.transfer.conftest import (
    PASSPHRASE,
    apply,
    check,
    export,
    fill,
    rebuild,
    restamp,
    snapshot,
    unpack,
    upload,
    w,
    wait_job,
    wipe_data,
)

# --- round trip -------------------------------------------------------------------------------


def test_round_trip_into_an_empty_instance_restores_everything_byte_for_byte(logged_in):
    fill(logged_in)
    before = snapshot(logged_in)
    job, data = export(logged_in)
    assert data.startswith(container.MAGIC)
    counts = job["preview"]["source"]["counts"]
    assert counts["reports"] == 2 and counts["report_attachments"] == 3 and counts["notes"] == 2
    assert job["preview"]["source"]["files"] == 3
    # Encrypted: no record text, no evidence bytes, no file names in the archive.
    for secret in (b"SQLi", "«тест»".encode(), b"payload a", b"\x89PNG", b"shot.png", b"manifest"):
        assert secret not in data

    wipe_data()
    assert logged_in.get("/api/reports").json()["total"] == 0

    checked = check(logged_in, data)
    assert checked["status"] == "validated", checked
    preview = checked["preview"]
    assert preview["source"]["counts"] == counts
    assert preview["target"] == {"counts": dict.fromkeys(counts, 0), "populated": False}
    assert preview["space"]["needed_bytes"] > 0 and preview["space"]["free_bytes"] > 0
    assert logged_in.get("/api/reports").json()["total"] == 0  # checking changed nothing

    res = apply(logged_in, checked["id"])  # empty instance: no confirmation needed
    assert res.status_code == 202, res.text
    done = wait_job(logged_in, checked["id"])
    assert done["status"] == "done", done
    assert done["backup_name"] is None  # nothing to back up
    assert snapshot(logged_in) == before  # ids, dates, statuses, tags, links, bytes
    # New records continue after the imported ids.
    new = logged_in.post(
        "/api/projects", json={"name": "After", "type": "bounty_program"}, headers=w(logged_in)
    )
    assert new.json()["id"] > max(p["id"] for p in before["projects"])
    # Nothing decrypted is left behind; the applied upload is gone.
    names = [p.name for p in get_settings().transfer_dir.iterdir()]
    assert not [n for n in names if n.startswith((".plain-", ".tmp-"))]
    assert not list(get_settings().uploads_dir.parent.glob(".uploads-*"))


def test_a_fresh_installation_with_a_new_owner_account(logged_in):
    """Linux → new install: the account is created there; the history follows the new owner."""
    fill(logged_in)
    before = snapshot(logged_in)
    _job, data = export(logged_in)
    # A new installation: empty data, a different owner account.
    wipe_data()
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE users, user_sessions, transfer_jobs RESTART IDENTITY CASCADE"))
    from app.modules.auth.service import create_user

    with SessionLocal() as db:
        create_user(db, "newowner", PASSWORD)
    client = TestClient(create_app(), base_url="http://127.0.0.1:8000")
    with client:
        assert (
            client.post(
                "/api/auth/login", json={"username": "newowner", "password": PASSWORD}
            ).status_code
            == 200
        )
        checked = check(client, data)
        assert checked["preview"]["source"]["source_owner"] == "researcher"
        assert apply(client, checked["id"]).status_code == 202
        assert wait_job(client, checked["id"])["status"] == "done"
        after = snapshot(client)
        events = client.get("/api/activity?size=100").json()["items"]
    assert after == before
    # Every recorded actor is now this installation's owner (accounts are not carried).
    assert {e["actor"] for e in events} == {"newowner"}


# --- refusals before anything changes ---------------------------------------------------------


def test_wrong_passphrase_is_told_apart_and_can_be_retried(logged_in):
    fill(logged_in)
    _job, data = export(logged_in)
    failed = check(logged_in, data, "not the right passphrase at all")
    assert failed["status"] == "failed" and failed["error_code"] == "transfer_wrong_passphrase"
    res = logged_in.post(
        f"/api/transfer/jobs/{failed['id']}/check",
        json={"passphrase": PASSPHRASE},
        headers=w(logged_in),
    )
    assert res.status_code == 202
    assert wait_job(logged_in, failed["id"])["status"] == "validated"


@pytest.mark.parametrize(
    ("damage", "code"),
    [
        (lambda d: d[: len(d) // 2], "transfer_corrupt"),  # cut short
        (lambda d: d[:-40] + bytes(40), "transfer_corrupt"),  # last chunk changed
        (lambda d: d + b"trailing", "transfer_corrupt"),  # data after the final chunk
        (lambda d: d[:400] + bytes([d[400] ^ 1]) + d[401:], "transfer_corrupt"),  # a flipped bit
    ],
)
def test_a_damaged_archive_is_refused(logged_in, damage, code):
    fill(logged_in)
    _job, data = export(logged_in)
    before = snapshot(logged_in)
    failed = check(logged_in, damage(data))
    assert failed["status"] == "failed" and failed["error_code"] == code
    assert snapshot(logged_in) == before


def test_a_file_that_is_not_an_archive_is_refused_at_upload(logged_in):
    before = set(get_settings().transfer_dir.iterdir())
    res = upload(logged_in, b"PK\x03\x04 just a zip")
    assert res.status_code == 422 and res.json()["code"] == "transfer_not_hexops"
    assert set(get_settings().transfer_dir.iterdir()) == before  # nothing kept


def _drop_file(entries, manifest):
    name = next(n for n in entries if n.startswith("files/"))
    del entries[name]


def _traversal(zf):
    zf.writestr("../../etc/cron.d/evil", b"* * * * * root id")


def _absolute(zf):
    zf.writestr("/tmp/evil", b"x")  # noqa: S108 - a hostile entry name, not a real path


def _symlink(zf):
    info = zipfile.ZipInfo("files/" + "a" * 32)
    info.external_attr = 0o120777 << 16
    zf.writestr(info, "/etc/passwd")


def _extra_file(zf):
    zf.writestr("files/" + "b" * 32, b"unlisted")


def _tamper_rows(entries, manifest):
    doc = json.loads(entries["data/reports.json"])
    doc["rows"][0][doc["columns"].index("title")] = "changed"
    entries["data/reports.json"] = json.dumps(doc).encode()  # manifest not updated


def _duplicate_ids(entries, manifest):
    doc = json.loads(entries["data/projects.json"])
    doc["rows"].append(list(doc["rows"][0]))
    entries["data/projects.json"] = json.dumps(doc).encode()
    restamp(entries, manifest, "projects")


def _broken_reference(entries, manifest):
    doc = json.loads(entries["data/reports.json"])
    doc["rows"][0][doc["columns"].index("project_id")] = 99999
    entries["data/reports.json"] = json.dumps(doc).encode()
    restamp(entries, manifest, "reports")


def _bad_value(entries, manifest):
    doc = json.loads(entries["data/reports.json"])
    doc["rows"][0][doc["columns"].index("severity")] = "apocalyptic"
    entries["data/reports.json"] = json.dumps(doc).encode()
    restamp(entries, manifest, "reports")


def _wrong_file_bytes(entries, manifest):
    name = next(n for n in entries if n.startswith("files/"))
    entries[name] = b"not the evidence"


def _old_schema(entries, manifest):
    manifest["schema_version"] = "0001"


def _new_format(entries, manifest):
    manifest["format_version"] = 99


@pytest.mark.parametrize(
    ("change", "extra", "code"),
    [
        (_drop_file, None, "transfer_missing_file"),
        (None, _traversal, "transfer_unsafe_path"),
        (None, _absolute, "transfer_unsafe_path"),
        (None, _symlink, "transfer_unsafe_path"),
        (None, _extra_file, "transfer_unexpected_file"),
        (_tamper_rows, None, "transfer_checksum_mismatch"),
        (_duplicate_ids, None, "transfer_duplicate_id"),
        (_broken_reference, None, "transfer_broken_reference"),
        (_bad_value, None, "transfer_invalid_data"),
        (_wrong_file_bytes, None, "transfer_checksum_mismatch"),
        (_old_schema, None, "transfer_schema_mismatch"),
        (_new_format, None, "transfer_unsupported_version"),
    ],
)
def test_every_check_runs_before_live_data_is_touched(logged_in, change, extra, code):
    fill(logged_in)
    _job, data = export(logged_in)
    bad = rebuild(data, change or (lambda e, m: None), extra)
    before = snapshot(logged_in)
    failed = check(logged_in, bad)
    assert failed["status"] == "failed" and failed["error_code"] == code, failed
    assert snapshot(logged_in) == before
    assert not list(get_settings().uploads_dir.parent.glob(".uploads-*"))


def test_size_and_entry_limits_stop_zip_bombs(logged_in, monkeypatch):
    fill(logged_in)
    _job, data = export(logged_in)
    bomb = rebuild(
        data, lambda e, m: None, lambda zf: zf.writestr("files/" + "c" * 32, bytes(20_000_000))
    )
    assert len(bomb) < 1_000_000  # 20 MB of zeros compress to almost nothing
    monkeypatch.setattr(get_settings(), "transfer_max_unpacked_bytes", 5_000_000)
    failed = check(logged_in, bomb)
    assert failed["error_code"] == "transfer_too_large"
    monkeypatch.setattr(get_settings(), "transfer_max_unpacked_bytes", 8 * 1024**3)
    monkeypatch.setattr(get_settings(), "transfer_max_entries", 5)
    assert check(logged_in, data)["error_code"] == "transfer_too_many_entries"


def test_the_archive_size_limit(logged_in, monkeypatch):
    fill(logged_in)
    _job, data = export(logged_in)
    monkeypatch.setattr(get_settings(), "transfer_max_archive_bytes", len(data) - 1)
    res = upload(logged_in, data)
    assert res.status_code == 413 and res.json()["code"] == "transfer_too_large"


# --- replacing a populated instance -----------------------------------------------------------


def test_replacing_data_needs_confirmation_and_a_verified_backup(logged_in):
    fill(logged_in, "old")
    original = snapshot(logged_in)
    _job, old_archive = export(logged_in)
    wipe_data()
    fill(logged_in, "new")
    _job, new_archive = export(logged_in)
    wipe_data()
    checked = check(logged_in, old_archive)
    apply(logged_in, checked["id"])
    assert wait_job(logged_in, checked["id"])["status"] == "done"
    assert snapshot(logged_in) == original  # instance holds the "old" data again

    checked = check(logged_in, new_archive)
    assert checked["preview"]["target"]["populated"] is True
    res = apply(logged_in, checked["id"])  # no confirmation
    assert res.status_code == 409 and res.json()["code"] == "transfer_confirmation_required"
    assert snapshot(logged_in) == original  # never merged, never overwritten silently

    assert apply(logged_in, checked["id"], replace=True).status_code == 202
    done = wait_job(logged_in, checked["id"])
    assert done["status"] == "done", done
    titles = {r["title"] for r in snapshot(logged_in)["reports"]}
    assert titles == {"SQLi «тест» oʻzbek new", "Info leak new"}

    # The pre-import backup exists, is private, and restores the previous state.
    backup = get_settings().backups_dir / done["backup_name"]
    assert backup.is_file() and backup.stat().st_mode & 0o077 == 0
    restore = check(logged_in, backup.read_bytes())
    assert restore["status"] == "validated"
    assert apply(logged_in, restore["id"], replace=True).status_code == 202
    assert wait_job(logged_in, restore["id"])["status"] == "done"
    assert snapshot(logged_in) == original


def test_a_failure_while_writing_rows_leaves_everything_as_it_was(logged_in, monkeypatch):
    fill(logged_in, "keep")
    before = snapshot(logged_in)
    files_before = sorted(p.name for p in get_settings().uploads_dir.iterdir())
    wipe_and_other = None
    _job, keep_archive = export(logged_in)
    wipe_data()
    fill(logged_in, "other")
    _job, other_archive = export(logged_in)
    wipe_data()
    checked = check(logged_in, keep_archive)
    apply(logged_in, checked["id"])
    wait_job(logged_in, checked["id"])
    assert snapshot(logged_in) == before
    files_before = sorted(p.name for p in get_settings().uploads_dir.iterdir())
    del wipe_and_other

    real = jobs._replace_rows

    def half_then_fail(db, package, importer_id):  # noqa: ANN001
        real(db, package, importer_id)  # every table already deleted and re-inserted...
        raise RuntimeError("disk on fire")  # ...then the import fails before COMMIT

    monkeypatch.setattr(jobs, "_replace_rows", half_then_fail)
    checked = check(logged_in, other_archive)
    apply(logged_in, checked["id"], replace=True)
    failed = wait_job(logged_in, checked["id"])
    assert failed["status"] == "failed" and failed["error_code"] == "transfer_apply_failed"
    assert snapshot(logged_in) == before  # rows rolled back
    assert sorted(p.name for p in get_settings().uploads_dir.iterdir()) == files_before  # files too
    assert not list(get_settings().uploads_dir.parent.glob(".uploads-*"))
    assert maintenance.active() is None  # writes allowed again


def test_a_crash_between_the_directory_swap_and_commit_is_undone_on_restart(logged_in, tmp_path):
    fill(logged_in)
    uploads = get_settings().uploads_dir
    before_files = sorted(p.name for p in uploads.iterdir())
    with SessionLocal() as db:
        uid = db.scalar(select(User.id))
        job = TransferJob(
            kind=TransferKind.import_,
            status=TransferStatus.running,
            created_by=uid,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        db.add(job)
        db.commit()
        job_id = job.id
    # The state a crash leaves: old files moved aside, new ones in place, no COMMIT.
    previous = uploads.parent / f".uploads-pre-import-{job_id}"
    staging = uploads.parent / f".uploads-import-{job_id}"
    os.replace(uploads, previous)
    uploads.mkdir()
    (uploads / ("e" * 32)).write_bytes(b"half-imported")
    jobs._marker(job_id).write_text(
        json.dumps({"uploads": str(uploads), "staging": str(staging), "previous": str(previous)})
    )
    (storage.transfer_dir() / ".plain-leftover").write_bytes(b"decrypted zip")

    with TestClient(create_app(), base_url="http://127.0.0.1:8000"):  # startup = recovery
        pass
    assert sorted(p.name for p in uploads.iterdir()) == before_files
    assert not previous.exists() and not staging.exists() and not jobs._marker(job_id).exists()
    assert not (storage.transfer_dir() / ".plain-leftover").exists()
    job = wait_job(logged_in, job_id)
    assert job["status"] == "failed" and job["error_code"] == "transfer_job_interrupted"


def test_a_crash_after_commit_keeps_the_imported_files(logged_in):
    uploads = get_settings().uploads_dir
    with SessionLocal() as db:
        job = TransferJob(
            kind=TransferKind.import_,
            status=TransferStatus.done,
            created_by=db.scalar(select(User.id)),
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        db.add(job)
        db.commit()
        job_id = job.id
    previous = uploads.parent / f".uploads-pre-import-{job_id}"
    previous.mkdir()
    (previous / ("f" * 32)).write_bytes(b"old")
    (uploads / ("d" * 32)).write_bytes(b"new")
    jobs._marker(job_id).write_text(
        json.dumps(
            {
                "uploads": str(uploads),
                "staging": str(uploads.parent / "x"),
                "previous": str(previous),
            }
        )
    )
    jobs.recover_interrupted()
    assert (uploads / ("d" * 32)).exists() and not previous.exists()


# --- consistency, privacy, access --------------------------------------------------------------


def test_writes_wait_outside_while_an_export_or_import_holds_the_data(logged_in):
    assert maintenance.begin("export")
    try:
        res = logged_in.post(
            "/api/projects", json={"name": "X", "type": "bounty_program"}, headers=w(logged_in)
        )
        assert res.status_code == 503 and res.json()["code"] == "maintenance_in_progress"
        assert logged_in.get("/api/projects").status_code == 200  # reads keep working
        assert logged_in.get("/api/transfer/state").json()["busy"] is True
        res = logged_in.post(
            "/api/transfer/exports", json={"passphrase": PASSPHRASE}, headers=w(logged_in)
        )
        assert res.status_code == 409 and res.json()["code"] == "transfer_busy"
    finally:
        maintenance.end()
    res = logged_in.post(
        "/api/projects", json={"name": "X", "type": "bounty_program"}, headers=w(logged_in)
    )
    assert res.status_code == 201


def test_an_export_is_a_consistent_snapshot_of_rows_and_files(logged_in):
    fill(logged_in)
    _job, data = export(logged_in)
    with zipfile.ZipFile(io.BytesIO(unpack(data))) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        rows = json.loads(zf.read("data/report_attachments.json"))
        files = {i.filename for i in zf.infolist() if i.filename.startswith("files/")}
        for f in manifest["files"]:
            body = zf.read(f["path"])
            assert hashlib.sha256(body).hexdigest() == f["sha256"] and len(body) == f["size"]
    assert manifest["format"] == "hexops-export" and manifest["format_version"] == 1
    assert manifest["schema_version"] == "0008"
    assert manifest["totals"]["records"] == sum(t["rows"] for t in manifest["tables"].values())
    col = rows["columns"].index("storage_name")
    assert files == {f"files/{r[col]}" for r in rows["rows"]}
    assert set(manifest["tables"]) == {
        "projects",
        "project_scope_items",
        "reports",
        "report_attachments",
        "tags",
        "notes",
        "note_tags",
        "activity_logs",
    }  # no users, sessions, pdf jobs or transfer jobs


def test_the_passphrase_is_never_stored_or_logged(logged_in, caplog):
    caplog.set_level(logging.DEBUG)
    fill(logged_in)
    job, _data = export(logged_in)
    check(logged_in, _data, "a wrong passphrase for the log test")
    with engine.connect() as conn:
        rows = (
            conn.execute(text("SELECT row_to_json(t)::text FROM transfer_jobs t")).scalars().all()
        )
    blob = " ".join(rows)
    for secret in (PASSPHRASE, "a wrong passphrase for the log test"):
        assert secret not in blob and secret not in caplog.text
    for path in get_settings().transfer_dir.iterdir():
        if path.is_file():
            assert PASSPHRASE.encode() not in path.read_bytes()


def test_short_passphrases_are_refused(logged_in):
    res = logged_in.post(
        "/api/transfer/exports", json={"passphrase": "short"}, headers=w(logged_in)
    )
    assert res.status_code == 422
    res = upload(logged_in, container.MAGIC + b"x", "short")
    assert res.status_code == 422 and res.json()["errors"][0]["code"] == "passphrase_too_short"


ROUTES = [
    ("GET", "/api/transfer/state"),
    ("POST", "/api/transfer/exports"),
    ("POST", "/api/transfer/imports"),
    ("GET", "/api/transfer/jobs/1"),
    ("POST", "/api/transfer/jobs/1/check"),
    ("POST", "/api/transfer/jobs/1/apply"),
    ("GET", "/api/transfer/jobs/1/download"),
    ("DELETE", "/api/transfer/jobs/1"),
]


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_every_route_needs_a_session(client, method, path):
    assert client.request(method, path).status_code == 401


@pytest.mark.parametrize(("method", "path"), [r for r in ROUTES if r[0] != "GET"])
def test_every_write_needs_csrf(logged_in, method, path):
    res = logged_in.request(method, path, headers={"Origin": "http://127.0.0.1:5173"})
    assert res.status_code == 403


def test_an_interrupted_export_is_failed_on_restart(logged_in):
    with SessionLocal() as db:
        db.add(
            TransferJob(
                kind=TransferKind.export,
                status=TransferStatus.running,
                created_by=db.scalar(select(User.id)),
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        db.commit()
    assert jobs.recover_interrupted() == 1


def test_expired_jobs_and_archives_are_swept_but_backups_are_kept(logged_in):
    fill(logged_in)
    job, _data = export(logged_in)
    with SessionLocal() as db:  # closed at once: an open session would block cleanup
        archive_file = storage.path_for(db.get(TransferJob, job["id"]).archive_name)  # type: ignore[arg-type]
    assert archive_file.exists()
    with engine.begin() as conn:
        conn.execute(text("UPDATE transfer_jobs SET expires_at = now() - interval '1 minute'"))
    assert jobs.sweep_expired() == 1
    assert not archive_file.exists()
    assert logged_in.get(f"/api/transfer/jobs/{job['id']}").status_code == 404


def test_archive_inspection_refuses_a_non_zip():
    path = storage.new_temp(storage.PLAIN_PREFIX)
    path.write_bytes(b"not a zip")
    try:
        with pytest.raises(archive.ArchiveError) as err:
            archive.inspect(path, "0008", archive.Limits(100, 10**9), lambda _p: None)
        assert err.value.code == "transfer_corrupt"
    finally:
        path.unlink()
