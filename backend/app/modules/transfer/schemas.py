from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.modules.transfer.models import TransferKind, TransferStatus

# A passphrase protects every record and file in the archive; the UI asks for 12+ characters.
Passphrase = Field(min_length=12, max_length=1024)


class ExportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    passphrase: str = Passphrase


class CheckIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    passphrase: str = Passphrase


class ApplyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    passphrase: str = Passphrase
    # Required when this installation already has data: the owner confirms replacing it.
    replace: bool = False


class JobOut(BaseModel):
    id: int
    kind: TransferKind
    status: TransferStatus
    stage: str
    progress: int
    archive_size: int | None
    original_name: str | None
    preview: dict[str, Any] | None
    backup_name: str | None
    error_code: str | None
    created_at: datetime
    finished_at: datetime | None
    expires_at: datetime
    download_name: str | None = None


class StateOut(BaseModel):
    """This installation's data, for the Settings → Data page."""

    counts: dict[str, int]
    populated: bool
    busy: bool
    max_archive_bytes: int


class JobWait(BaseModel):
    model_config = ConfigDict(extra="forbid")

    wait: int = Field(default=0, ge=0, le=25)
