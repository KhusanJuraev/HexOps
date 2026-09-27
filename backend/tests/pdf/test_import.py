"""Stage 7 import: text PDFs become an editable Markdown draft, never a saved record (D-84)."""

import pymupdf
import pytest

from app.core.config import get_settings
from app.modules.pdf import importer
from tests.pdf.conftest import (
    export,
    image_only_pdf,
    import_pdf,
    text_pdf,
    upload,
    w,
)


def counts(client) -> tuple[int, int]:
    reports = client.get("/api/reports").json()["total"]
    notes = client.get("/api/notes").json()["total"]
    return reports, notes


def test_an_exported_report_imports_back_as_structured_markdown(logged_in, report):
    exported = export(logged_in, "report", report["id"], "uz")
    pdf = logged_in.get(f"/api/pdf/jobs/{exported['id']}/download").content
    before = counts(logged_in)

    job = import_pdf(logged_in, pdf, "hisobot.pdf")
    assert job["status"] == "done", job
    assert job["kind"] == "import" and job["page_count"] == 1
    assert job["original_name"] == "hisobot.pdf"
    draft = job["draft"]
    md = draft["markdown"]
    assert draft["title"] == report["title"]
    # Headings come back at their original levels (the title is not repeated).
    assert "# Kirish\n" in md and "## Введение\n" in md and "## Overview\n" in md
    assert f"# {report['title']}" not in md
    # Three languages, as text.
    assert "gʻalaba va oʻquvchi" in md and "съешь же ещё этих мягких" in md
    # Code comes back fenced, lines and indentation intact.
    assert '```\ndef payload():\n    return "\' OR 1=1 --"\n```' in md
    # The ruled table comes back as a Markdown table.
    assert "|Host|Port|" in md and "|10.0.0.5|443|" in md and "|api.example.com|8443|" in md
    assert "pdf_tables_detected" in job["warnings"]
    # Nothing was saved: the draft waits for the user.
    assert counts(logged_in) == before


def test_running_footers_repeated_on_every_page_are_dropped(logged_in, project):
    body = "Page one.\n\n\\pagebreak\n\nPage two.\n\n\\pagebreak\n\nPage three.\n"
    res = logged_in.post(
        "/api/notes", json={"title": "Footers", "body_md": body}, headers=w(logged_in)
    )
    exported = export(logged_in, "note", res.json()["id"])
    pdf = logged_in.get(f"/api/pdf/jobs/{exported['id']}/download").content
    md = import_pdf(logged_in, pdf)["draft"]["markdown"]
    assert "Page one." in md and "Page three." in md
    assert " / 3" not in md and "HexOps · Footers" not in md


def test_a_heading_wrapped_over_several_lines_stays_one_heading(logged_in):
    body = "# " + " ".join(["Uzun sarlavha"] * 12) + "\n\nMatn.\n"
    res = logged_in.post(
        "/api/notes", json={"title": "Wrapped " + "W" * 150, "body_md": body}, headers=w(logged_in)
    )
    exported = export(logged_in, "note", res.json()["id"])
    pdf = logged_in.get(f"/api/pdf/jobs/{exported['id']}/download").content
    draft = import_pdf(logged_in, pdf)["draft"]
    assert draft["title"] == "Wrapped " + "W" * 150
    assert draft["markdown"].count("# ") == 1  # neither the title nor the heading is split
    assert "# " + " ".join(["Uzun sarlavha"] * 12) in draft["markdown"]


def test_a_note_export_round_trips_too(logged_in, note):
    exported = export(logged_in, "note", note["id"], "ru")
    pdf = logged_in.get(f"/api/pdf/jobs/{exported['id']}/download").content
    job = import_pdf(logged_in, pdf)
    assert job["draft"]["title"] == note["title"]
    assert "## Введение" in job["draft"]["markdown"]


def test_a_plain_text_pdf_in_three_languages(logged_in):
    pdf = text_pdf(
        [
            "Oʻzbek tilidagi matn: gʻisht, shoʻrva.",
            "Русский текст на второй странице.",
            "English text on page three.",
        ]
    )
    job = import_pdf(logged_in, pdf, "three.pdf")
    assert job["status"] == "done", job
    md = job["draft"]["markdown"]
    assert "Oʻzbek tilidagi matn: gʻisht, shoʻrva." in md
    assert "Русский текст на второй странице." in md
    assert "English text on page three." in md
    assert job["page_count"] == 3
    assert job["draft"]["title"] == "three"  # no metadata title, no heading: the file name


def test_the_draft_saves_as_a_new_report_or_note_through_the_normal_apis(logged_in, project):
    job = import_pdf(logged_in, text_pdf(["Imported finding text."]))
    draft = job["draft"]
    res = logged_in.post(
        "/api/notes",
        json={"title": draft["title"], "body_md": draft["markdown"]},
        headers=w(logged_in),
    )
    assert res.status_code == 201 and "Imported finding text." in res.json()["body_md"]
    res = logged_in.post(
        "/api/reports",
        json={
            "project_id": project,
            "title": draft["title"],
            "type": "vdp",
            "severity": "low",
            "body_md": draft["markdown"],
        },
        headers=w(logged_in),
    )
    assert res.status_code == 201
    assert counts(logged_in) == (1, 1)


def test_extracted_text_cannot_turn_into_markdown_syntax(logged_in):
    job = import_pdf(logged_in, text_pdf(["# not a heading *not bold* `x`"]))
    md = job["draft"]["markdown"]
    assert md.startswith("\\# not a heading \\*not bold\\* \\`x\\`")


def test_an_image_only_pdf_is_refused_with_no_ocr(logged_in, pdf_dir):
    job = import_pdf(logged_in, image_only_pdf(2), "scan.pdf")
    assert job["status"] == "failed" and job["error_code"] == "pdf_no_text"
    assert job["draft"] is None
    assert list(pdf_dir.iterdir()) == []  # the upload is gone


def test_pages_without_text_are_reported(logged_in):
    doc = pymupdf.open(stream=text_pdf(["Only this page has text."]), filetype="pdf")
    doc.insert_pdf(pymupdf.open(stream=image_only_pdf(1), filetype="pdf"))
    job = import_pdf(logged_in, doc.tobytes())
    assert job["status"] == "done"
    assert set(job["warnings"]) >= {"pdf_pages_without_text", "pdf_images_skipped"}


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"%PDF-1.7\n1 0 obj << /Type /Catalog >>\ngarbage without xref", "pdf_malformed"),
        (b"%PDF-1.4\n" + bytes(range(256)) * 20, "pdf_malformed"),
    ],
)
def test_malformed_pdfs_fail_with_a_clear_code(logged_in, data, code, pdf_dir):
    job = import_pdf(logged_in, data)
    assert job["status"] == "failed" and job["error_code"] == code
    assert list(pdf_dir.iterdir()) == []


def test_an_encrypted_pdf_is_refused(logged_in):
    doc = pymupdf.open(stream=text_pdf(["secret"]), filetype="pdf")
    data = doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="pw", owner_pw="owner")
    job = import_pdf(logged_in, data)
    assert job["status"] == "failed" and job["error_code"] == "pdf_encrypted"


@pytest.mark.parametrize(
    ("data", "name", "code"),
    [
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, "photo.pdf", "pdf_unsupported"),
        (b"just some text", "notes.txt", "pdf_unsupported"),
        (b"", "empty.pdf", "pdf_empty"),
    ],
)
def test_files_that_are_not_pdfs_are_refused_before_a_job(logged_in, data, name, code, pdf_dir):
    res = upload(logged_in, data, name)
    assert res.status_code == 422 and res.json()["code"] == code
    assert list(pdf_dir.iterdir()) == []  # nothing kept


def test_the_page_limit(logged_in, monkeypatch):
    monkeypatch.setattr(get_settings(), "pdf_import_max_pages", 2)
    job = import_pdf(logged_in, text_pdf(["one", "two", "three"]))
    assert job["status"] == "failed" and job["error_code"] == "pdf_too_many_pages"
    assert import_pdf(logged_in, text_pdf(["one", "two"]))["status"] == "done"


def test_the_size_limit(logged_in, monkeypatch, pdf_dir):
    data = text_pdf(["x " * 2000])
    monkeypatch.setattr(get_settings(), "pdf_import_max_bytes", len(data) - 1)
    res = upload(logged_in, data)
    assert res.status_code == 413 and res.json()["code"] == "pdf_too_large"
    assert list(pdf_dir.iterdir()) == []
    monkeypatch.setattr(get_settings(), "pdf_import_max_bytes", len(data))
    assert upload(logged_in, data).status_code == 202


def test_an_oversized_request_is_refused_before_it_is_read(logged_in):
    limit = get_settings().pdf_import_max_bytes
    res = logged_in.post(
        "/api/pdf/imports",
        content=b"x",
        headers={
            **w(logged_in),
            "Content-Type": "multipart/form-data; boundary=x",
            "Content-Length": str(limit + 10 * 1024 * 1024),
        },
    )
    assert res.status_code == 413 and res.json()["code"] == "pdf_too_large"


def test_a_draft_longer_than_a_record_body_is_refused(logged_in, monkeypatch):
    monkeypatch.setattr(importer, "MAX_DRAFT_CHARS", 50)
    job = import_pdf(logged_in, text_pdf(["x" * 80]))
    assert job["status"] == "failed" and job["error_code"] == "pdf_text_too_long"


def test_the_upload_is_deleted_once_read(logged_in, pdf_dir):
    job = import_pdf(logged_in, text_pdf(["kept only as a draft"]))
    assert job["status"] == "done"
    assert list(pdf_dir.iterdir()) == []


def test_a_missing_file_part_is_a_field_error(logged_in):
    res = logged_in.post(
        "/api/pdf/imports", files={"other": ("a.pdf", b"%PDF-1.4")}, headers=w(logged_in)
    )
    assert res.status_code == 422
