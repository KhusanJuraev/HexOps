"""Stage 7 export: saved Reports and Notes become rendered PDFs (D-83)."""

import threading
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

import pymupdf
import pytest

from app.core.export import ExportDocument
from app.modules.pdf import exporter
from app.modules.pdf.render import document_html
from tests.pdf.conftest import export, w

LABELS = {
    "en": ("Severity", "High", "Status", "Draft", "Report"),
    "ru": ("Критичность", "Высокая", "Статус", "Черновик", "Отчёт"),
    "uz": ("Jiddiylik", "Yuqori", "Holat", "Qoralama", "Hisobot"),
}


def download(client, job: dict) -> pymupdf.Document:
    res = client.get(f"/api/pdf/jobs/{job['id']}/download")
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/pdf"
    assert res.headers["content-disposition"].startswith("attachment;")
    assert res.headers["cache-control"] == "no-store"
    assert "sandbox" in res.headers["content-security-policy"]
    assert res.content.startswith(b"%PDF-")
    return pymupdf.open(stream=res.content, filetype="pdf")


def text_of(doc: pymupdf.Document) -> str:
    return "\n".join(page.get_text() for page in doc)


@pytest.mark.parametrize("lang", ["en", "ru", "uz"])
def test_report_exports_as_a_rendered_pdf_in_each_language(logged_in, report, lang):
    job = export(logged_in, "report", report["id"], lang)
    assert job["status"] == "done", job
    assert job["progress"] == 100 and job["error_code"] is None
    assert job["result_filename"] == "SQL injection — «Тест» oʻzbek.pdf"

    doc = download(logged_in, job)
    text = text_of(doc)
    # Metadata labels and values are translated; the title is the PDF's title.
    for word in LABELS[lang]:  # the kind label is printed in capitals
        assert word.casefold() in text.casefold(), (lang, word)
    assert doc.metadata["title"] == report["title"]
    assert "Acme Corp" in text and "8.6 CVSS:3.1/AV:N" in text
    # Dates day first, 24-hour, labelled UTC (D-89); never ISO or month-first.
    import re

    assert re.search(r"\b\d{2}/\d{2}/\d{4} \d{2}:\d{2} UTC\b", text)
    assert not re.search(r"\b\d{4}-\d{2}-\d{2}\b", text)
    # All three languages survive as text (not boxes, not transliterated).
    for phrase in ("gʻalaba va oʻquvchi", "съешь же ещё этих мягких", "the injection point"):
        assert phrase in text
    # Code keeps its line breaks and quotes; the table keeps its cells.
    assert "def payload():" in text and 'return "\' OR 1=1 --"' in text
    for cell in ("Host", "Port", "10.0.0.5", "api.example.com", "8443"):
        assert cell in text
    # Rendered, not raw Markdown.
    assert "```" not in text and "| Host |" not in text and "## " not in text
    # Headings become the PDF outline under the title.
    toc = doc.get_toc()
    assert toc[0][:2] == [1, report["title"]]
    assert [t[1] for t in toc[1:]] == ["Kirish", "Введение", "Overview"]
    # Code is printed in a monospace font.
    fonts = {
        span["font"]
        for page in doc
        for b in page.get_text("dict")["blocks"]
        for line in b.get("lines", [])
        for span in line["spans"]
        if "payload" in span["text"]
    }
    assert fonts and all("Mono" in f for f in fonts), fonts


def test_note_exports_with_its_tags_and_project(logged_in, note):
    job = export(logged_in, "note", note["id"], "ru")
    assert job["status"] == "done", job
    text = text_of(download(logged_in, job))
    assert "ЗАМЕТКА" in text and "Теги" in text and "recon" in text and "todo" in text
    assert "Acme Corp" in text and note["title"] in text
    assert "Критичность" not in text  # report-only metadata is not printed for notes


def test_page_breaks_and_long_content_paginate(logged_in, project):
    body = "Birinchi sahifa.\n\n\\pagebreak\n\nIkkinchi sahifa.\n\n" + "\n\n".join(
        f"Paragraph {i}: " + "lorem ipsum " * 30 for i in range(40)
    )
    res = logged_in.post(
        "/api/notes", json={"title": "Paged", "body_md": body}, headers=w(logged_in)
    )
    job = export(logged_in, "note", res.json()["id"])
    doc = download(logged_in, job)
    assert doc.page_count >= 3
    assert "Birinchi sahifa." in doc[0].get_text()
    assert "Ikkinchi sahifa." not in doc[0].get_text()
    assert "Ikkinchi sahifa." in doc[1].get_text()
    assert "\\pagebreak" not in text_of(doc)
    # Footer on every page: page x / y.
    assert f"1 / {doc.page_count}" in doc[0].get_text()
    assert f"{doc.page_count} / {doc.page_count}" in doc[-1].get_text()


def test_unsafe_markdown_prints_as_text_and_loads_nothing(logged_in, project):
    hits: list[str] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            hits.append(self.path)
            self.send_response(200)
            self.end_headers()

        def log_message(self, *_args) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        body = (
            f"<script>document.title='pwned'</script>\n\n"
            f'<img src="{base}/raw-img"> <iframe src="file:///etc/passwd"></iframe>\n\n'
            f"![tracker]({base}/md-img) [js](javascript:alert(1)) [local](file:///etc/passwd)"
            f" [ok]({base}/link)\n"
        )
        res = logged_in.post(
            "/api/notes", json={"title": "Hostile", "body_md": body}, headers=w(logged_in)
        )
        job = export(logged_in, "note", res.json()["id"])
        assert job["status"] == "done", job
        doc = download(logged_in, job)
        text = text_of(doc)
    finally:
        server.shutdown()
    assert hits == []  # nothing was fetched: no image, no link, no iframe
    assert "<script>" in text and "<img src=" in text  # shown as text, like the app does
    assert "[Image: tracker]" in text
    assert "root:x:0:0" not in text  # no local file was read
    assert doc.metadata["title"] == "Hostile"  # the script never ran


def test_the_renderer_refuses_requests_even_for_raw_html(tmp_path):
    """Defence in depth: HTML that bypasses Markdown still cannot reach anything."""
    secret = tmp_path / "secret.txt"
    secret.write_text("TOP-SECRET-CONTENT")
    doc = ExportDocument(kind="note", title="Raw", body_md="plain")
    page = document_html(doc, "en").replace(
        "<main",
        f'<img src="http://127.0.0.1:9/x.png"><iframe src="file://{secret}"></iframe>'
        f'<link rel="stylesheet" href="https://example.com/x.css">'
        f'<script>document.body.innerHTML="SCRIPT-RAN"</script><main',
    )
    # Without the document's CSP, the route block is the last line of defence.
    page = page.replace("default-src 'none'", "default-src *")
    blocked: list[str] = []
    pdf = exporter.html_to_pdf(page, "en", datetime.now(UTC), 30, blocked)
    text = "".join(p.get_text() for p in pymupdf.open(stream=pdf, filetype="pdf"))
    assert "TOP-SECRET-CONTENT" not in text and "SCRIPT-RAN" not in text
    assert blocked, "the page tried to load resources and every one was aborted"
    assert all(
        u.startswith(("http://127.0.0.1:9", "https://example.com", "file:")) for u in blocked
    )


def test_export_of_a_missing_record_is_refused(logged_in):
    for kind in ("report", "note"):
        res = logged_in.post(
            "/api/pdf/exports",
            json={"source_type": kind, "source_id": 999, "lang": "en"},
            headers=w(logged_in),
        )
        assert res.status_code == 404 and res.json()["code"] == "pdf_source_not_found"


@pytest.mark.parametrize(
    "body",
    [
        {"source_type": "project", "source_id": 1},
        {"source_type": "report", "source_id": 0},
        {"source_type": "report", "source_id": 1, "lang": "de"},
        {"source_type": "report", "source_id": 1, "extra": 1},
    ],
)
def test_export_input_is_validated(logged_in, body):
    assert logged_in.post("/api/pdf/exports", json=body, headers=w(logged_in)).status_code == 422


def test_download_before_done_or_for_an_import_is_refused(logged_in, report):
    from tests.pdf.conftest import import_pdf, text_pdf

    job = import_pdf(logged_in, text_pdf(["Hello"]))
    res = logged_in.get(f"/api/pdf/jobs/{job['id']}/download")
    assert res.status_code == 409 and res.json()["code"] == "pdf_job_not_ready"
