import pytest
from pydantic import ValidationError

from app.core.config import Settings

BASE = {"database_url": "postgresql+psycopg://x@127.0.0.1/x", "secret_key": "k" * 40}


def test_defaults_bind_to_loopback():
    assert Settings(**BASE).host == "127.0.0.1"


def test_lan_binding_requires_explicit_opt_in():
    with pytest.raises(ValidationError, match="HEXOPS_ALLOW_LAN"):
        Settings(**BASE, host="0.0.0.0")  # noqa: S104
    assert Settings(**BASE, host="0.0.0.0", allow_lan=True).allow_lan  # noqa: S104


def test_short_secret_key_is_rejected():
    with pytest.raises(ValidationError):
        Settings(database_url=BASE["database_url"], secret_key="short")
