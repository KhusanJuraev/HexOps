"""Scope value validation. Values are checked, never rewritten (D-28).

Each check returns an error code or None. Codes are translated by the UI.
"""

import ipaddress
import re
from urllib.parse import urlsplit

from app.modules.projects.models import ScopeKind

_LABEL = re.compile(r"^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def _is_hostname(value: str) -> bool:
    """A DNS name with at least two labels and an alphabetic (or IDN) top-level label."""
    try:
        ascii_name = value.encode("idna").decode("ascii")
    except UnicodeError:
        return False
    if len(ascii_name) > 253 or ascii_name.endswith("."):
        return False
    labels = ascii_name.split(".")
    if len(labels) < 2 or not all(_LABEL.match(label) for label in labels):
        return False
    tld = labels[-1]
    return tld.isalpha() or tld.lower().startswith("xn--")


def _check_domain(value: str) -> str | None:
    return None if _is_hostname(value) else "scope_invalid_domain"


def _check_wildcard(value: str) -> str | None:
    if value.startswith("*.") and _is_hostname(value[2:]):
        return None
    return "scope_invalid_wildcard"


def _check_url(value: str) -> str | None:
    try:
        parts = urlsplit(value)
        port_ok = parts.port is None or parts.port > 0
    except ValueError:
        return "scope_invalid_url"
    host = parts.hostname or ""
    host_ok = _is_hostname(host) or _is_ip(host) or host.startswith("*.")
    if parts.scheme in ("http", "https") and host_ok and port_ok and " " not in value:
        return None
    return "scope_invalid_url"


def _is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


def _check_ip(value: str) -> str | None:
    return None if _is_ip(value) else "scope_invalid_ip"


def _check_cidr(value: str) -> str | None:
    if "/" not in value:
        return "scope_invalid_cidr"
    try:
        ipaddress.ip_network(value, strict=True)
    except ValueError:
        try:
            ipaddress.ip_network(value, strict=False)
        except ValueError:
            return "scope_invalid_cidr"
        # e.g. 10.0.0.5/24: we would have to rewrite it to 10.0.0.0/24, so refuse.
        return "scope_cidr_host_bits"
    return None


_CHECKS = {
    ScopeKind.domain: _check_domain,
    ScopeKind.wildcard: _check_wildcard,
    ScopeKind.url: _check_url,
    ScopeKind.ip: _check_ip,
    ScopeKind.cidr: _check_cidr,
    ScopeKind.other: lambda value: None,
}


def check_value(kind: ScopeKind, value: str) -> str | None:
    if value != value.strip():
        return "scope_value_whitespace"  # refuse rather than silently trim
    if _CONTROL.search(value):
        return "scope_value_control_chars"
    return _CHECKS[kind](value)


def duplicate_key(kind: ScopeKind, value: str) -> tuple[str, str]:
    """Host names are case-insensitive, so Example.com duplicates example.com."""
    if kind in (ScopeKind.domain, ScopeKind.wildcard):
        return (kind.value, value.casefold())
    return (kind.value, value)
