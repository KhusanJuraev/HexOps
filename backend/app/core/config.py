import ipaddress
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


def is_loopback(host: str) -> bool:
    host = host.strip().strip("[]")
    if host == "localhost":
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    mapped = getattr(address, "ipv4_mapped", None)  # ::ffff:127.0.0.1
    return address.is_loopback or bool(mapped and mapped.is_loopback)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="HEXOPS_",
        env_file=BACKEND_DIR / ".env",
        extra="ignore",
    )

    database_url: SecretStr
    secret_key: SecretStr = Field(min_length=32)

    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    allow_lan: bool = False
    cookie_secure: bool = False
    trusted_origins: Annotated[list[str], NoDecode] = [
        "http://127.0.0.1:5173",  # npm run dev
        "http://localhost:5173",
        "http://127.0.0.1:4173",  # npm run preview (the production build)
        "http://localhost:4173",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ]

    # Host header values the API answers to (hostname only, no port). Anything else
    # gets 400 invalid_host, which blocks DNS-rebinding attacks from web pages
    # opened on this machine (D-51). A non-loopback HEXOPS_HOST is added automatically.
    allowed_hosts: Annotated[list[str], NoDecode] = ["127.0.0.1", "localhost", "::1"]

    # Evidence files (Stage 4). Bytes on disk, metadata in PostgreSQL; back up both.
    uploads_dir: Path = BACKEND_DIR.parent / "data" / "uploads"
    max_upload_bytes: int = Field(default=25 * 1024 * 1024, ge=1024)
    max_attachments_per_report: int = Field(default=100, ge=1)

    # PDF export/import (Stage 7). Job files are private (0700/0600) and short-lived.
    pdf_dir: Path = BACKEND_DIR.parent / "data" / "pdf-jobs"
    pdf_import_max_bytes: int = Field(default=20 * 1024 * 1024, ge=1024)
    pdf_import_max_pages: int = Field(default=200, ge=1)
    pdf_result_ttl_minutes: int = Field(default=60, ge=1)
    pdf_job_timeout_seconds: int = Field(default=120, ge=5)

    # Full-data export/import (Settings → Data). Archives are encrypted; the working
    # directory is private (0700) and short-lived; pre-import backups are kept.
    transfer_dir: Path = BACKEND_DIR.parent / "data" / "transfer"
    backups_dir: Path = BACKEND_DIR.parent / "data" / "backups"
    transfer_max_archive_bytes: int = Field(default=2 * 1024**3, ge=1024)
    transfer_max_unpacked_bytes: int = Field(default=8 * 1024**3, ge=1024)
    transfer_max_entries: int = Field(default=200_000, ge=10)
    transfer_result_ttl_minutes: int = Field(default=60, ge=1)

    session_ttl_hours: int = Field(default=168, ge=1)
    session_idle_hours: int = Field(default=24, ge=1)
    enable_docs: bool = False

    login_max_failures: int = Field(default=5, ge=1)
    login_lockout_seconds: int = Field(default=300, ge=1)

    @field_validator("trusted_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [o.strip().rstrip("/") for o in value.split(",") if o.strip()]
        return value

    @field_validator("allowed_hosts", mode="before")
    @classmethod
    def split_hosts(cls, value: object) -> object:
        if isinstance(value, str):
            return [h.strip().lower().strip("[]") for h in value.split(",") if h.strip()]
        return value

    @model_validator(mode="after")
    def check_exposure(self) -> "Settings":
        if not is_loopback(self.host) and not self.allow_lan:
            raise ValueError(
                f"HEXOPS_HOST={self.host} is not a loopback address. "
                "Set HEXOPS_ALLOW_LAN=true to expose HexOps on the network explicitly."
            )
        if not is_loopback(self.host) and self.host not in ("0.0.0.0", "::"):  # noqa: S104
            self.allowed_hosts = [*self.allowed_hosts, self.host.lower()]
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
