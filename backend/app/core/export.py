"""What a module hands to the PDF export (Stage 7): a title, Markdown and metadata.

Lives in core so reports and notes can produce it without importing the pdf module,
and the pdf module can consume it without knowing either module's models.
"""

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class ExportDocument:
    kind: str  # "report" | "note"
    title: str
    body_md: str
    # (label key, value) in display order; the exporter translates keys and enum values.
    # Values are plain strings, or datetimes (printed in UTC), never pre-formatted text.
    fields: list[tuple[str, str | datetime]] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
