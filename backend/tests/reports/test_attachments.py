"""Evidence: types, content checks, limits, safe names, downloads, consistency."""

import hashlib
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.modules.reports import service, storage
from app.modules.reports.models import Attachment
from tests.reports.conftest import history, w

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
GIF = b"GIF89a" + b"\x00" * 32
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 32
PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n"
POC = "import requests\nprint('проверка ✓')\n".encode()


def upload(client, report_id: int, name: str, data: bytes, headers: dict | None = None):
    return client.post(
        f"/api/reports/{report_id}/attachments",
        files={"file": (name, data, "application/octet-stream")},
        headers=headers if headers is not None else w(client),
    )


def files_on_disk() -> list[Path]:
    return sorted(p for p in get_settings().uploads_dir.iterdir() if p.is_file())


def rows() -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(Attachment))


@pytest.fixture(autouse=True)
def empty_uploads():
    for p in files_on_disk():
        p.unlink()
    yield


@pytest.fixture
def report(make_report) -> int:
    return make_report()["id"]


# --- accepted files ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "data", "content_type"),
    [
        ("shot.png", PNG, "image/png"),
        ("shot.JPG", JPEG, "image/jpeg"),
        ("anim.gif", GIF, "image/gif"),
        ("img.webp", WEBP, "image/webp"),
        ("report.pdf", PDF, "application/pdf"),
        ("poc.py", POC, "text/plain; charset=utf-8"),
        ("poc.html", b"<script>alert(document.domain)</script>", "text/plain; charset=utf-8"),
        ("request.http", b"GET / HTTP/1.1\r\nHost: x\r\n\r\n", "text/plain; charset=utf-8"),
        ("notes.txt", "﻿BOM and UTF-8 ✓".encode(), "text/plain; charset=utf-8"),
    ],
)
def test_allowed_files_are_stored_with_a_server_chosen_type(
    logged_in, report, name, data, content_type
):
    res = upload(logged_in, report, name, data)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["original_name"] == name
    assert body["content_type"] == content_type  # never the client's claim
    assert body["size_bytes"] == len(data)
    assert body["sha256"] == hashlib.sha256(data).hexdigest()
    [path] = files_on_disk()
    assert path.read_bytes() == data
    assert len(path.name) == 32 and path.name != name  # random, unrelated to the upload name
    assert oct(path.stat().st_mode & 0o777) == "0o600"


# --- rejected files -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "data", "status", "code"),
    [
        ("evil.exe", b"MZ\x90\x00", 422, "attachment_type_not_allowed"),
        ("image.svg", b"<svg onload=alert(1)>", 422, "attachment_type_not_allowed"),
        ("archive.zip", b"PK\x03\x04", 422, "attachment_type_not_allowed"),
        ("noext", b"hello", 422, "attachment_type_not_allowed"),
        ("fake.png", b"<script>alert(1)</script>", 422, "attachment_content_mismatch"),
        ("fake.pdf", PNG, 422, "attachment_content_mismatch"),
        ("fake.jpg", PNG, 422, "attachment_content_mismatch"),
        ("binary.txt", b"abc\x00def", 422, "attachment_content_mismatch"),
        ("latin1.py", "caf\xe9".encode("latin-1"), 422, "attachment_content_mismatch"),
        ("empty.txt", b"", 422, "attachment_empty"),
    ],
)
def test_rejected_files_leave_nothing_behind(logged_in, report, name, data, status, code):
    res = upload(logged_in, report, name, data)
    assert res.status_code == status, res.text
    assert res.json()["code"] == code
    assert files_on_disk() == [] and rows() == 0


def test_size_limit_while_streaming(logged_in, report, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_bytes", 1024)
    assert upload(logged_in, report, "ok.txt", b"a" * 1024).status_code == 201
    res = upload(logged_in, report, "big.txt", b"a" * 1025)
    assert res.status_code == 413 and res.json()["code"] == "attachment_too_large"
    assert len(files_on_disk()) == 1 and rows() == 1


def test_oversized_request_is_refused_before_parsing(logged_in, report, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_bytes", 1024)
    res = upload(logged_in, report, "big.txt", b"a" * 200_000)
    assert res.status_code == 413
    assert files_on_disk() == []


def test_missing_content_length_is_refused(logged_in, report):
    def chunks():
        yield b'--x\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n'
        yield b"\r\nhi\r\n--x--\r\n"

    res = logged_in.post(
        f"/api/reports/{report}/attachments",
        content=chunks(),
        headers={**w(logged_in), "Content-Type": "multipart/form-data; boundary=x"},
    )
    assert res.status_code == 411 and res.json()["code"] == "length_required"


def test_missing_or_wrong_part(logged_in, report):
    res = logged_in.post(
        f"/api/reports/{report}/attachments", json={"file": "x"}, headers=w(logged_in)
    )
    assert res.status_code == 422
    res = logged_in.post(
        f"/api/reports/{report}/attachments",
        files={"other": ("a.txt", b"x", "text/plain")},
        headers=w(logged_in),
    )
    assert res.status_code == 422 and res.json()["errors"][0]["field"] == "file"


def test_per_report_limit(logged_in, report, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_attachments_per_report", 2)
    for i in range(2):
        assert upload(logged_in, report, f"{i}.txt", b"x").status_code == 201
    res = upload(logged_in, report, "3.txt", b"x")
    assert res.status_code == 409 and res.json()["code"] == "attachment_limit"


# --- names and paths -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("given", "kept"),
    [
        ("../../etc/passwd.txt", "passwd.txt"),
        ("..\\..\\windows\\win.ini.txt", "win.ini.txt"),
        ("/abs/path/poc.py", "poc.py"),
        ("....txt", "....txt"),
        ("semi;colon.txt", "semi;colon.txt"),
        ("файл отчёта.txt", "файл отчёта.txt"),
    ],
)
def test_filenames_are_display_only(logged_in, report, given, kept):
    res = upload(logged_in, report, given, b"x")
    assert res.status_code == 201, res.text
    assert res.json()["original_name"] == kept
    [path] = files_on_disk()
    assert path.parent == get_settings().uploads_dir  # nothing written anywhere else


@pytest.mark.parametrize(
    ("given", "kept"),
    [
        # Browsers percent-encode CR, LF and quotes in multipart names, so these
        # never arrive over HTTP; the sanitizer still handles them.
        ("evil\r\nX-Header: 1.txt", "evilX-Header: 1.txt"),
        ("tab\there\x00.txt", "tabhere.txt"),
        ("..", "file"),
        ("   ", "file"),
        ("a/b/../c.png", "c.png"),
        ("x" * 300 + ".png", "x" * 251 + ".png"),  # 255 characters in total
        ("e\u0301.txt", "\u00e9.txt"),  # NFC
    ],
)
def test_sanitize_filename(given, kept):
    assert service._sanitize_filename(given) == kept


def test_content_disposition_escapes_everything():
    from app.modules.reports.router import _content_disposition

    header = _content_disposition('a"b;c\\d\u00fc.txt')
    assert (
        header == "attachment; filename=\"a_b_c_d_.txt\"; filename*=UTF-8''a%22b%3Bc%5Cd%C3%BC.txt"
    )


def test_storage_names_cannot_escape():
    for bad in ["../x", "a" * 31, "A" * 32, "0" * 31 + "/", "..", ""]:
        with pytest.raises(ValueError):
            storage.path_for(bad)


# --- downloads ------------------------------------------------------------------------------------


def test_download_headers_force_a_safe_download(logged_in, report):
    a = upload(logged_in, report, "poc;ü.html", b"<script>alert(1)</script>").json()
    res = logged_in.get(f"/api/reports/{report}/attachments/{a['id']}/download")
    assert res.status_code == 200
    assert res.content == b"<script>alert(1)</script>"
    assert res.headers["content-type"] == "text/plain; charset=utf-8"
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["content-disposition"] == (
        "attachment; filename=\"poc__.html\"; filename*=UTF-8''poc%3B%C3%BC.html"
    )
    assert "sandbox" in res.headers["content-security-policy"]
    assert res.headers["cache-control"] == "no-store"


def test_download_requires_session_and_matching_report(logged_in, make_report, client):
    r1, r2 = make_report()["id"], make_report()["id"]
    a = upload(logged_in, r1, "a.png", PNG).json()
    assert logged_in.get(f"/api/reports/{r2}/attachments/{a['id']}/download").status_code == 404
    assert logged_in.get(f"/api/reports/{r1}/attachments/999999/download").status_code == 404
    logged_in.cookies.clear()
    assert logged_in.get(f"/api/reports/{r1}/attachments/{a['id']}/download").status_code == 401
    assert logged_in.get(f"/api/reports/{r1}/attachments").status_code == 401


def test_upload_requires_csrf(logged_in, report):
    res = upload(logged_in, report, "a.txt", b"x", headers={})
    assert res.status_code == 403 and res.json()["code"] == "csrf_failed"
    assert files_on_disk() == []


def test_missing_file_on_disk_is_reported(logged_in, report):
    a = upload(logged_in, report, "a.txt", b"x").json()
    files_on_disk()[0].unlink()
    res = logged_in.get(f"/api/reports/{report}/attachments/{a['id']}/download")
    assert res.status_code == 410 and res.json()["code"] == "attachment_file_missing"


# --- list, delete, consistency ------------------------------------------------------------------


def test_list_and_delete(logged_in, report):
    a = upload(logged_in, report, "a.txt", b"a").json()
    b = upload(logged_in, report, "b.png", PNG).json()
    listed = logged_in.get(f"/api/reports/{report}/attachments").json()
    assert [x["id"] for x in listed] == [a["id"], b["id"]]
    assert (
        logged_in.delete(f"/api/reports/{report}/attachments/{a['id']}").status_code == 403
    )  # CSRF
    assert (
        logged_in.delete(
            f"/api/reports/{report}/attachments/{a['id']}", headers=w(logged_in)
        ).status_code
        == 204
    )
    assert len(files_on_disk()) == 1 and rows() == 1
    actions = [e["action"] for e in history(logged_in, report)]
    assert actions == [
        "report.created",
        "report.attachment_added",
        "report.attachment_added",
        "report.attachment_deleted",
    ]


def test_deleting_a_report_removes_its_files(logged_in, report):
    upload(logged_in, report, "a.txt", b"a")
    upload(logged_in, report, "b.png", PNG)
    assert logged_in.delete(f"/api/reports/{report}", headers=w(logged_in)).status_code == 204
    assert files_on_disk() == [] and rows() == 0


def test_database_failure_leaves_no_orphan_file(logged_in, report, monkeypatch):
    real_event = service._event

    def failing_event(db, rep, action, *args, **kwargs):
        if action == "report.attachment_added":
            raise RuntimeError("simulated database failure")
        return real_event(db, rep, action, *args, **kwargs)

    monkeypatch.setattr(service, "_event", failing_event)
    with pytest.raises(RuntimeError):
        upload(logged_in, report, "a.txt", b"a")
    assert files_on_disk() == [] and rows() == 0


def test_stale_temp_files_are_swept():
    stale = get_settings().uploads_dir / ".tmp-deadbeef"
    stale.write_bytes(b"partial")
    import os

    os.utime(stale, (0, 0))
    assert storage.sweep_temp_files() == 1
    assert not stale.exists()
