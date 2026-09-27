"""Text-based PDF -> an editable Markdown draft with PyMuPDF (D-84).

What is recovered: text in reading order, headings (from the PDF outline when it has
one, otherwise from font size), monospace runs as code blocks, bullet lists, and
ruled tables as Markdown tables. Running headers/footers repeated on most pages are
dropped. Images are skipped. Complex layout (columns, merged cells, floating boxes)
is not reconstructed; the user reviews the draft before saving it.

A PDF with no extractable text is refused with pdf_no_text: there is no OCR.
"""

import re
import time
import unicodedata
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

pymupdf.TOOLS.mupdf_display_errors(False)  # malformed input is reported, not printed
pymupdf.no_recommend_layout()  # keep an optional-package hint out of the server log

MAX_DRAFT_CHARS = 200_000  # the Report/Note body limit
_BULLET = re.compile(r"^[•◦▪▫●○■□‣⁃–—]\s+")
_ESCAPE_START = re.compile(r"^(#{1,6}\s|>|\||```|~~~|[-+*]\s|\d+[.)]\s)")
_DIGITS = re.compile(r"\d+")
_MONO = ("mono", "courier", "consol", "menlo", "code")


class ImportFailed(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass
class Draft:
    title: str
    markdown: str
    page_count: int
    warnings: list[str] = field(default_factory=list)


@dataclass
class _Line:
    text: str
    size: float
    bold: bool
    mono: bool
    block: int
    y0: float
    y1: float


def _norm(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text).split()).casefold()


def _is_mono(span: dict) -> bool:
    return bool(span["flags"] & 8) or any(m in span["font"].lower() for m in _MONO)


def _escape(text: str) -> str:
    """Keep extracted prose from turning into Markdown syntax by accident."""
    text = text.replace("\\", "\\\\").replace("*", "\\*").replace("`", "\\`")
    return "\\" + text if _ESCAPE_START.match(text) else text


def _page_lines(page: pymupdf.Page, skip: list[pymupdf.Rect]) -> list[_Line]:
    """Text lines outside the given table areas (image blocks are not requested)."""
    data = page.get_text("dict", sort=True, flags=pymupdf.TEXT_PRESERVE_WHITESPACE)
    lines: list[_Line] = []
    for number, block in enumerate(data["blocks"]):
        for line in block.get("lines", []):
            spans = [s for s in line["spans"] if s["text"].strip()]
            if not spans:
                continue
            rect = pymupdf.Rect(line["bbox"])
            if any(
                rect.intersects(t) and (rect & t).get_area() > 0.5 * rect.get_area() for t in skip
            ):
                continue
            text = "".join(s["text"] for s in line["spans"]).rstrip()
            mono = all(_is_mono(s) for s in spans)
            if not mono:
                text = " ".join(text.split())
            lines.append(
                _Line(
                    text=text,
                    size=round(max(s["size"] for s in spans), 1),
                    bold=all(s["flags"] & 16 for s in spans),
                    mono=mono,
                    block=number,
                    y0=rect.y0,
                    y1=rect.y1,
                )
            )
    return lines


def _running_text(pages: list[tuple[list[_Line], float]]) -> set[str]:
    """Header/footer lines: near the top or bottom edge on at least half the pages."""
    if len(pages) < 2:
        return set()
    seen: Counter[str] = Counter()
    for lines, height in pages:
        keys = {
            _DIGITS.sub("#", _norm(line.text))
            for line in lines
            if line.y1 < height * 0.08 or line.y0 > height * 0.92
        }
        seen.update(keys)
    return {k for k, n in seen.items() if n >= max(2, len(pages) / 2)}


def _heading_levels(sizes: Counter[float], body: float) -> dict[float, int]:
    """Font sizes clearly above body text, largest first, mapped to levels 1-3."""
    bigger = sorted((s for s in sizes if s >= body * 1.15), reverse=True)
    return {size: min(3, i + 1) for i, size in enumerate(bigger)}


def _toc_level(toc: dict[tuple[str, int], int], text: str, page: int) -> int | None:
    """The outline level of a heading, also for the first lines of a wrapped one."""
    key = _norm(text)
    if (key, page) in toc:
        return toc[(key, page)]
    if len(key) >= 8:
        squashed = key.replace(" ", "")
        for (title, on_page), level in toc.items():
            if on_page == page and title.replace(" ", "").startswith(squashed):
                return level
    return None


def _flush(out: list[str], paragraph: list[str], code: list[str]) -> None:
    if paragraph:
        out.append(" ".join(paragraph))
        paragraph.clear()
    if code:
        out.append("```\n" + "\n".join(code) + "\n```")
        code.clear()


def extract(
    path: Path,
    max_pages: int,
    deadline: float,
    progress: Callable[[int], None] = lambda _p: None,
) -> Draft:
    try:
        doc = pymupdf.open(path, filetype="pdf")
    except Exception as exc:  # noqa: BLE001 - PyMuPDF raises several types for bad input
        raise ImportFailed("pdf_malformed") from exc
    with doc:
        if doc.needs_pass or doc.is_encrypted:
            raise ImportFailed("pdf_encrypted")
        if not doc.is_pdf:
            raise ImportFailed("pdf_unsupported")
        try:
            page_count = doc.page_count
        except Exception as exc:  # noqa: BLE001
            raise ImportFailed("pdf_malformed") from exc
        if page_count == 0:
            raise ImportFailed("pdf_malformed")
        if page_count > max_pages:
            raise ImportFailed("pdf_too_many_pages")

        toc = {(_norm(title), page): level for level, title, page in doc.get_toc(simple=True)}
        pages: list[tuple[list[_Line], float]] = []
        tables: list[list[tuple[float, str]]] = []
        images = 0
        try:
            for index, page in enumerate(doc):
                if time.monotonic() > deadline:
                    raise ImportFailed("pdf_job_timeout")
                # lines_strict: ruled tables only; filled boxes (code blocks) are not grids.
                found = page.find_tables(strategy="lines_strict")
                page_tables = [
                    (t.bbox[1], t.to_markdown(clean=False).strip()) for t in found.tables
                ]
                lines = _page_lines(page, [pymupdf.Rect(t.bbox) for t in found.tables])
                pages.append((lines, page.rect.height))
                tables.append([t for t in page_tables if t[1]])
                images += len(page.get_images())  # counted only, never decoded
                progress(10 + int(80 * (index + 1) / page_count))
        except ImportFailed:
            raise
        except Exception as exc:  # noqa: BLE001 - a broken page stream
            raise ImportFailed("pdf_malformed") from exc
        metadata_title = (doc.metadata or {}).get("title") or ""

    if not any(lines for lines, _h in pages) and not any(tables):
        raise ImportFailed("pdf_no_text")

    running = _running_text(pages)
    sizes: Counter[float] = Counter()
    for lines, _h in pages:
        for line in lines:
            if not line.mono:
                sizes[line.size] += len(line.text)
    body_size = sizes.most_common(1)[0][0] if sizes else 10.0
    levels = _heading_levels(sizes, body_size)

    out: list[str] = []
    headings: list[tuple[int, int, str]] = []  # (index in out, level, text)
    for page_no, ((lines, _height), page_tables) in enumerate(zip(pages, tables, strict=True), 1):
        pending_tables = sorted(page_tables)
        paragraph: list[str] = []
        code: list[str] = []
        last_block = None

        def flush(paragraph: list[str] = paragraph, code: list[str] = code) -> None:
            _flush(out, paragraph, code)

        for line in lines:
            while pending_tables and pending_tables[0][0] <= line.y0:
                flush()
                out.append(pending_tables.pop(0)[1])
            if _DIGITS.sub("#", _norm(line.text)) in running:
                continue
            if line.mono:
                if paragraph:
                    flush()
                code.append(line.text)
                last_block = line.block
                continue
            if code:
                flush()
            prev = headings[-1] if headings else None
            if prev and prev[0] == len(out) - 1 and line.block == last_block and not paragraph:
                # A long heading wrapped onto several lines is still one heading.
                joined = f"{prev[2]} {line.text}"
                if _toc_level(toc, joined, page_no) or levels.get(line.size) == prev[1]:
                    headings[-1] = (prev[0], prev[1], joined)
                    continue
            level = _toc_level(toc, line.text, page_no) or (
                levels.get(line.size) if len(line.text) <= 200 else None
            )
            if level:
                flush()
                level = min(level, 6)
                headings.append((len(out), level, line.text))
                out.append("")  # filled in below, once the levels are final
                last_block = line.block
                continue
            bullet = _BULLET.match(line.text)
            if bullet:
                flush()
                paragraph.append("- " + _escape(line.text[bullet.end() :]))
            else:
                if line.block != last_block:
                    flush()
                paragraph.append(_escape(line.text))
            last_block = line.block
        flush()
        out.extend(t[1] for t in pending_tables)

    title = " ".join(metadata_title.split())[:300]
    if not title and headings:
        title = headings[0][2][:300]
    # The title printed as the first heading (as HexOps exports do) is not repeated,
    # and the remaining headings move up so the top level is "#" again.
    # Compared without spaces: a long word broken across lines comes back split.
    if headings and _norm(headings[0][2]).replace(" ", "") == _norm(title).replace(" ", ""):
        out[headings[0][0]] = ""
        headings = headings[1:]
    shift = min((level for _i, level, _t in headings), default=1) - 1
    for index, level, text in headings:
        out[index] = f"{'#' * (level - shift)} {_escape(text)}"
    markdown = "\n\n".join(part for part in out if part).strip() + "\n"
    if len(markdown) > MAX_DRAFT_CHARS:
        raise ImportFailed("pdf_text_too_long")

    warnings = []
    if any(tables):
        warnings.append("pdf_tables_detected")
    if images:
        warnings.append("pdf_images_skipped")
    if any(not lines and not t for (lines, _h), t in zip(pages, tables, strict=True)):
        warnings.append("pdf_pages_without_text")
    return Draft(title=title, markdown=markdown, page_count=page_count, warnings=warnings)
