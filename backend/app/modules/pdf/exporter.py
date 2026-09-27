"""HTML -> PDF with Playwright's headless Chromium (D-83).

The page is inert: JavaScript is disabled, the context is offline, and every request
the page would make (images, fonts, links, file:// or http://) is aborted before it
leaves the browser. A fresh browser is started per job and always closed.
"""

from datetime import datetime

from app.modules.pdf.render import footer_template


class ExportFailed(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def html_to_pdf(
    page_html: str,
    lang: str,
    exported_at: datetime,
    timeout_s: int,
    blocked: list[str] | None = None,
) -> bytes:
    """Print the page. Every URL the page tried to load is appended to `blocked`."""
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright

    timeout_ms = timeout_s * 1000
    blocked = blocked if blocked is not None else []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(timeout=timeout_ms)
            try:
                context = browser.new_context(
                    java_script_enabled=False, offline=True, accept_downloads=False
                )

                def abort(route) -> None:  # noqa: ANN001 - Playwright's Route
                    blocked.append(route.request.url)
                    route.abort()

                context.route("**/*", abort)
                page = context.new_page()
                page.set_default_timeout(timeout_ms)
                page.set_content(page_html, wait_until="load")
                return page.pdf(
                    format="A4",
                    print_background=True,
                    prefer_css_page_size=True,
                    display_header_footer=True,
                    header_template="<span></span>",
                    footer_template=footer_template(lang, exported_at),
                    margin={"top": "20mm", "bottom": "20mm", "left": "18mm", "right": "18mm"},
                    outline=True,
                    tagged=True,
                )
            finally:
                browser.close()
    except PlaywrightError as exc:
        text = str(exc)
        if "Executable doesn't exist" in text or "playwright install" in text:
            raise ExportFailed("pdf_renderer_missing") from exc
        if "Timeout" in type(exc).__name__ or "Timeout" in text:
            raise ExportFailed("pdf_job_timeout") from exc
        raise ExportFailed("pdf_export_failed") from exc
