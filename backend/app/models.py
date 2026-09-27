"""Import every module's models so Alembic and tests see the full metadata.

Adding a module with tables means adding its models import here.
"""

from app.core.db import Base
from app.modules.activity.models import ActivityLog
from app.modules.auth.models import User, UserSession
from app.modules.notes.models import Note, Tag, note_tags
from app.modules.pdf.models import PdfJob
from app.modules.projects.models import Project, ScopeItem
from app.modules.reports.models import Attachment, Report
from app.modules.transfer.models import TransferJob

__all__ = [
    "ActivityLog",
    "Attachment",
    "Base",
    "Note",
    "PdfJob",
    "Project",
    "Report",
    "ScopeItem",
    "Tag",
    "TransferJob",
    "User",
    "UserSession",
    "note_tags",
]
