"""Markdown -> a self-contained, inert HTML document for printing (D-83).

Safety, in layers:
- Raw HTML in Markdown is escaped (html=False), as in the app's MarkdownView.
- Links keep only http(s), mailto and #fragments; anything else prints as text.
- Images are never loaded: they print as "[Image: alt] url", like the app shows them.
- The document has a CSP of default-src 'none' (inline styles only), and the
  exporter additionally disables JavaScript and aborts every network request.
- Fonts are the operating system's (no @font-face, no downloads).
"""

import html
import re
from datetime import UTC, datetime

from markdown_it import MarkdownIt
from markdown_it.token import Token
from mdit_py_plugins.tasklists import tasklists_plugin

from app.core.export import ExportDocument
from app.modules.pdf.labels import label, value

PAGE_BREAK = "\\pagebreak"  # a line of its own starts a new page in the PDF
_SAFE_URL = re.compile(r"^(https?:|mailto:|#)", re.IGNORECASE)
ENUM_FIELDS = frozenset({"type", "severity", "status"})


def _validate_link(url: str) -> bool:
    return bool(_SAFE_URL.match(url.strip()))


def _markdown() -> MarkdownIt:
    md = MarkdownIt("commonmark", {"html": False, "linkify": False, "typographer": False})
    md.enable(["table", "strikethrough"])
    md.use(tasklists_plugin)
    md.validateLink = _validate_link  # type: ignore[method-assign]
    return md


_MD = _markdown()


def _page_breaks(tokens: list[Token]) -> list[Token]:
    """A paragraph that is exactly \\pagebreak becomes a page-break marker."""
    out: list[Token] = []
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if (
            t.type == "paragraph_open"
            and i + 2 < len(tokens)
            and tokens[i + 1].type == "inline"
            and tokens[i + 1].content.strip() == PAGE_BREAK
            and tokens[i + 2].type == "paragraph_close"
        ):
            marker = Token("html_block", "", 0)
            marker.content = '<div class="page-break" aria-hidden="true"></div>\n'
            out.append(marker)
            i += 3
            continue
        out.append(t)
        i += 1
    return out


def markdown_to_html(source: str, lang: str, heading_offset: int = 1) -> str:
    """Render Markdown safely. '#' becomes h2 by default: the document title owns h1."""
    env: dict = {}
    tokens = _page_breaks(_MD.parse(source, env))
    image_label = html.escape(label(lang, "image"))
    for token in tokens:
        if token.type in ("heading_open", "heading_close"):
            level = min(6, int(token.tag[1]) + heading_offset)
            token.tag = f"h{level}"
        for child in token.children or []:
            if child.type == "image":
                alt = html.escape("".join(c.content for c in child.children or []))
                src = child.attrGet("src") or ""
                shown = html.escape(str(src)) if _validate_link(str(src)) else ""
                child.type = "html_inline"
                child.content = (
                    f'<span class="image-ref">[{image_label}: {alt}]'
                    + (f" <span class='url'>{shown}</span>" if shown else "")
                    + "</span>"
                )
                child.children = None
    return _MD.renderer.render(tokens, _MD.options, env)


def format_utc(moment: datetime) -> str:
    """DD/MM/YYYY HH:mm (24-hour) in UTC, labelled, like every date in the UI (D-89)."""
    return moment.astimezone(UTC).strftime("%d/%m/%Y %H:%M UTC")


def _field_value(lang: str, key: str, raw: str | datetime) -> str:
    if isinstance(raw, datetime):
        return format_utc(raw)
    return value(lang, key, raw) if key in ENUM_FIELDS else raw


STYLE = """
@page { size: A4; margin: 20mm 18mm 20mm 18mm; }
:root { color-scheme: light; }
* { box-sizing: border-box; }
html { font-size: 10.5pt; }
body {
  margin: 0; color: #1c1f24; background: #fff;
  font-family: "Noto Sans", "DejaVu Sans", "Liberation Sans", "Segoe UI", Arial, sans-serif;
  line-height: 1.5; overflow-wrap: anywhere;
}
header.doc { border-bottom: 2px solid #1c1f24; padding-bottom: 8pt; margin-bottom: 14pt; }
.kind { font-size: 8.5pt; letter-spacing: .08em; text-transform: uppercase; color: #5b6270; }
h1 { font-size: 20pt; line-height: 1.2; margin: 2pt 0 0; }
h2 { font-size: 15pt; margin: 18pt 0 6pt; }
h3 { font-size: 12.5pt; margin: 14pt 0 5pt; }
h4, h5, h6 { font-size: 11pt; margin: 12pt 0 4pt; }
h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; }
p, li { orphans: 3; widows: 3; }
dl.meta {
  display: grid; grid-template-columns: max-content 1fr; gap: 3pt 14pt;
  margin: 0 0 16pt; font-size: 9.5pt;
}
dl.meta dt { color: #5b6270; }
dl.meta dd { margin: 0; }
.tags span { display: inline-block; border: 1px solid #c9ced6; border-radius: 3pt;
  padding: 0 4pt; margin: 0 3pt 2pt 0; font-size: 8.5pt; }
a { color: #1d4ed8; text-decoration: underline; }
code, pre {
  font-family: "DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", Consolas, monospace;
}
code { font-size: 9pt; background: #f1f3f5; padding: 0 2pt; border-radius: 2pt; }
pre {
  font-size: 8.5pt; line-height: 1.4; background: #f6f7f9; border: 1px solid #dde1e6;
  border-radius: 3pt; padding: 7pt 8pt; white-space: pre-wrap; overflow-wrap: anywhere;
  break-inside: auto;
}
pre code { background: none; padding: 0; font-size: inherit; }
blockquote { margin: 8pt 0; padding: 0 0 0 10pt; border-left: 3px solid #c9ced6; color: #3d434d; }
table { width: 100%; border-collapse: collapse; margin: 8pt 0; font-size: 9pt; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th, td { border: 1px solid #c9ced6; padding: 3pt 5pt; text-align: left; vertical-align: top; }
th { background: #eef0f3; }
hr { border: 0; border-top: 1px solid #c9ced6; margin: 14pt 0; }
ul.contains-task-list { list-style: none; padding-left: 12pt; }
.image-ref { color: #5b6270; font-style: italic; }
.image-ref .url { font-style: normal; font-size: 8.5pt; }
.page-break { break-after: page; page-break-after: always; height: 0; }
"""


def document_html(doc: ExportDocument, lang: str) -> str:
    """The complete HTML page Chromium prints. Every value is escaped."""
    esc = html.escape
    rows = "".join(
        f"<dt>{esc(label(lang, key))}</dt><dd>{esc(_field_value(lang, key, raw))}</dd>"
        for key, raw in doc.fields
        if raw not in ("", None)
    )
    if doc.tags:
        tags = "".join(f"<span>{esc(t)}</span>" for t in doc.tags)
        rows += f'<dt>{esc(label(lang, "tags"))}</dt><dd class="tags">{tags}</dd>'
    body = markdown_to_html(doc.body_md, lang)
    return (
        "<!doctype html>"
        f'<html lang="{esc(lang)}"><head><meta charset="utf-8">'
        '<meta http-equiv="Content-Security-Policy" '
        "content=\"default-src 'none'; style-src 'unsafe-inline'\">"
        f"<title>{esc(doc.title)}</title><style>{STYLE}</style></head><body>"
        f'<header class="doc"><div class="kind">HexOps · {esc(label(lang, "kind." + doc.kind))}'
        f"</div><h1>{esc(doc.title)}</h1></header>"
        f'<dl class="meta">{rows}</dl>'
        f'<main class="markdown">{body}</main>'
        "</body></html>"
    )


def footer_template(lang: str, exported_at: datetime) -> str:
    """Chromium's footer: title, export time and page x / y (Chromium escapes the title)."""
    stamp = html.escape(f"{label(lang, 'exported')} {format_utc(exported_at)}")
    return (
        '<div style="width:100%;font-size:7.5pt;color:#5b6270;padding:0 18mm;'
        'font-family:DejaVu Sans,sans-serif;display:flex;justify-content:space-between;">'
        f'<span>HexOps · <span class="title"></span></span><span>{stamp}</span>'
        '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
    )
