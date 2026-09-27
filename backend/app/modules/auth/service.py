import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import (
    hash_password,
    needs_rehash,
    new_token,
    token_digest,
    verify_password,
)
from app.modules.auth.models import User, UserSession

# Refresh last_seen_at at most this often to avoid a write on every request.
_TOUCH_INTERVAL = timedelta(minutes=5)


def normalize_username(username: str) -> str:
    return username.strip().lower()


def utcnow() -> datetime:
    return datetime.now(UTC)


class LoginThrottle:
    """Process-local failed-login counter.

    Good enough for a single-process, single-user local app. It resets on restart
    and is not shared between workers; see docs/DECISIONS.md.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._failures: dict[str, tuple[int, float]] = {}

    def retry_after(self, key: str) -> int:
        settings = get_settings()
        with self._lock:
            count, first = self._failures.get(key, (0, 0.0))
            elapsed = time.monotonic() - first
            if elapsed >= settings.login_lockout_seconds:
                self._failures.pop(key, None)
                return 0
            if count >= settings.login_max_failures:
                return max(1, int(settings.login_lockout_seconds - elapsed))
            return 0

    def record_failure(self, key: str) -> None:
        with self._lock:
            count, first = self._failures.get(key, (0, time.monotonic()))
            self._failures[key] = (count + 1, first)

    def reset(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._failures.clear()
            else:
                self._failures.pop(key, None)


login_throttle = LoginThrottle()


@dataclass
class IssuedSession:
    record: UserSession
    token: str
    csrf_token: str


def authenticate(db: Session, username: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.username == normalize_username(username)))
    valid = verify_password(user.password_hash if user else None, password)
    if user is None or not valid:
        return None
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    return user


def create_session(db: Session, user: User, user_agent: str | None) -> IssuedSession:
    settings = get_settings()
    now = utcnow()
    token, csrf_token = new_token(), new_token()
    record = UserSession(
        user_id=user.id,
        token_hash=token_digest(token),
        csrf_hash=token_digest(csrf_token),
        last_seen_at=now,
        expires_at=now + timedelta(hours=settings.session_ttl_hours),
        user_agent=(user_agent or "")[:255] or None,
    )
    user.last_login_at = now
    db.add(record)
    # Opportunistic cleanup keeps the table small without a background job.
    db.execute(delete(UserSession).where(UserSession.expires_at < now))
    db.commit()
    return IssuedSession(record=record, token=token, csrf_token=csrf_token)


def resolve_session(db: Session, token: str) -> UserSession | None:
    settings = get_settings()
    record = db.scalar(select(UserSession).where(UserSession.token_hash == token_digest(token)))
    if record is None:
        return None
    now = utcnow()
    idle_limit = record.last_seen_at + timedelta(hours=settings.session_idle_hours)
    if record.expires_at <= now or idle_limit <= now:
        db.delete(record)
        db.commit()
        return None
    if now - record.last_seen_at >= _TOUCH_INTERVAL:
        record.last_seen_at = now
        db.commit()
    return record


def revoke_session(db: Session, record: UserSession) -> None:
    db.delete(record)
    db.commit()


def create_user(db: Session, username: str, password: str) -> User:
    user = User(username=normalize_username(username), password_hash=hash_password(password))
    db.add(user)
    db.commit()
    return user


def set_password(db: Session, user: User, password: str) -> None:
    user.password_hash = hash_password(password)
    # Changing the password signs out every existing session.
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.commit()


class InvalidCurrentPassword(Exception):
    pass


class PasswordReused(Exception):
    pass


def change_password(db: Session, user: User, current: str, new: str) -> None:
    """Verify the current password, refuse reuse, store the new Argon2id hash and
    revoke every session of the user, including the one making the request."""
    if not verify_password(user.password_hash, current):
        raise InvalidCurrentPassword
    if verify_password(user.password_hash, new):
        raise PasswordReused
    set_password(db, user, new)


class UsernameUnchanged(Exception):
    pass


class UsernameTaken(Exception):
    pass


def change_username(db: Session, user: User, new_username: str, current_password: str) -> None:
    """Rename the login identifier only: same user id, same password hash.

    Usernames are stored lower-cased, so a change of letter case alone is "unchanged".
    Every session of the user is revoked, including the one making the request. Other
    records point at the user id, never at the name, so nothing is orphaned (D-91).
    """
    if not verify_password(user.password_hash, current_password):
        raise InvalidCurrentPassword
    username = normalize_username(new_username)
    if username == user.username:
        raise UsernameUnchanged
    if db.scalar(select(exists().where(User.username == username, User.id != user.id))):
        raise UsernameTaken
    user.username = username
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    try:
        db.commit()
    except IntegrityError:  # a concurrent rename to the same name
        db.rollback()
        raise UsernameTaken from None


class SetupClosed(Exception):
    """First-run setup is no longer possible: an account already exists."""


def owner_exists(db: Session) -> bool:
    return bool(db.scalar(select(exists().select_from(User))))


def setup_owner(db: Session, username: str, password: str) -> User:
    """Create the one and only account, if none exists yet.

    The existence check is a fast path. The guarantee comes from the database:
    the uq_users_single_owner index lets only one row ever be inserted, so of two
    concurrent requests exactly one commits and the other gets SetupClosed.
    Existing accounts are never modified.
    """
    if owner_exists(db):
        raise SetupClosed
    try:
        return create_user(db, username, password)
    except IntegrityError:
        db.rollback()
        raise SetupClosed from None
