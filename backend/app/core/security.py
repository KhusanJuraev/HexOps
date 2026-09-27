import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

# argon2id with argon2-cffi's RFC 9106 "low memory" defaults (t=3, m=64 MiB, p=4).
_hasher = PasswordHasher()
# Verified against when the username is unknown, so both paths cost the same.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(32))

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 256


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    key = get_settings().secret_key.get_secret_value().encode()
    return hmac.new(key, token.encode(), hashlib.sha256).hexdigest()


def digests_match(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
