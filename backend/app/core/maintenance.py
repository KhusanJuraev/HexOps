"""A process-wide "data maintenance" state (a full export or import is running).

While it is on, the API refuses new writes with 503 maintenance_in_progress (see the
middleware in app/main.py); writes already running are allowed to finish first
(`begin` waits for them). So an export sees one consistent state of rows and files,
and an import never races a user edit. Reads keep working. One holder at a time.
"""

import threading
import time

_cond = threading.Condition()
_reason: str | None = None
_writes = 0


def begin(reason: str, drain_timeout: float = 30.0) -> bool:
    """Turn maintenance on and wait for in-flight writes. False if busy or they don't end."""
    global _reason
    with _cond:
        if _reason is not None:
            return False
        _reason = reason
        deadline = time.monotonic() + drain_timeout
        while _writes > 0:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _reason = None
                return False
            _cond.wait(remaining)
    return True


def end() -> None:
    global _reason
    with _cond:
        _reason = None
        _cond.notify_all()


def active() -> str | None:
    return _reason


def enter_write() -> bool:
    """Called by the middleware for a state-changing request. False = refuse it."""
    global _writes
    with _cond:
        if _reason is not None:
            return False
        _writes += 1
        return True


def leave_write() -> None:
    global _writes
    with _cond:
        _writes -= 1
        _cond.notify_all()
