from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import ErrorBody, api_error, field_error
from app.modules.auth import service
from app.modules.auth.deps import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    check_origin,
    get_current_session,
    require_loopback_client,
)
from app.modules.auth.models import UserSession
from app.modules.auth.schemas import (
    LoginRequest,
    PasswordChangeRequest,
    SessionOut,
    SetupRequest,
    SetupStatus,
    UsernameChangeRequest,
    UserOut,
)

router = APIRouter(
    prefix="/api/auth",
    tags=["auth"],
    responses={code: {"model": ErrorBody} for code in (401, 403, 409, 422, 429)},
)


def _set_session_cookies(response: Response, issued: service.IssuedSession) -> None:
    settings = get_settings()
    max_age = settings.session_ttl_hours * 3600
    common = {
        "max_age": max_age,
        "secure": settings.cookie_secure,
        "samesite": "strict",
        "path": "/",
    }
    response.set_cookie(SESSION_COOKIE, issued.token, httponly=True, **common)
    # Readable by the frontend so it can echo the value in the X-CSRF-Token header.
    response.set_cookie(CSRF_COOKIE, issued.csrf_token, httponly=False, **common)


def _clear_session_cookies(response: Response) -> None:
    settings = get_settings()
    for name in (SESSION_COOKIE, CSRF_COOKIE):
        response.delete_cookie(name, path="/", secure=settings.cookie_secure, samesite="strict")


def _session_out(record: UserSession) -> SessionOut:
    return SessionOut(user=UserOut.model_validate(record.user), expires_at=record.expires_at)


@router.post("/login", response_model=SessionOut, dependencies=[Depends(check_origin)])
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> SessionOut:
    client = request.client.host if request.client else "unknown"
    throttle_key = f"{client}:{service.normalize_username(body.username)}"
    retry_after = service.login_throttle.retry_after(throttle_key)
    if retry_after:
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many failed attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    user = service.authenticate(db, body.username, body.password)
    if user is None:
        service.login_throttle.record_failure(throttle_key)
        raise api_error(
            status.HTTP_401_UNAUTHORIZED, "invalid_credentials", "Invalid username or password"
        )

    service.login_throttle.reset(throttle_key)
    issued = service.create_session(db, user, request.headers.get("user-agent"))
    _set_session_cookies(response, issued)
    return _session_out(issued.record)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    record: UserSession = Depends(get_current_session),
    db: Session = Depends(get_db),
) -> Response:
    service.revoke_session(db, record)
    response.status_code = status.HTTP_204_NO_CONTENT
    _clear_session_cookies(response)
    return response


@router.get("/me", response_model=SessionOut)
def me(record: UserSession = Depends(get_current_session)) -> SessionOut:
    return _session_out(record)


@router.get("/setup", response_model=SetupStatus)
def setup_status(db: Session = Depends(get_db)) -> SetupStatus:
    """Public: tells the UI whether to show first-run setup instead of sign-in."""
    return SetupStatus(required=not service.owner_exists(db))


@router.post(
    "/setup",
    response_model=SessionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_origin), Depends(require_loopback_client)],
)
def setup(
    body: SetupRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> SessionOut:
    """Create the owner account on an empty database, then sign it in.

    Only from a loopback client, only while no account exists (enforced by a unique
    index, see service.setup_owner). Afterwards it always answers 409: there is no
    general registration. Headless setup and recovery use `python -m app.cli`.
    """
    try:
        user = service.setup_owner(db, body.username, body.password)
    except service.SetupClosed:
        raise api_error(
            status.HTTP_409_CONFLICT, "setup_closed", "An account already exists"
        ) from None
    issued = service.create_session(db, user, request.headers.get("user-agent"))
    _set_session_cookies(response, issued)
    return _session_out(issued.record)


@router.post("/username", status_code=status.HTTP_204_NO_CONTENT)
def change_username(
    body: UsernameChangeRequest,
    response: Response,
    record: UserSession = Depends(get_current_session),  # session + CSRF + Origin
    db: Session = Depends(get_db),
) -> Response:
    """Change the signed-in user's username, then sign out everywhere (D-91).

    Wrong current passwords are throttled like logins. On failure the session is kept;
    on success every session is revoked and the cookies are cleared.
    """
    throttle_key = f"username-change:{record.user_id}"
    retry_after = service.login_throttle.retry_after(throttle_key)
    if retry_after:
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many failed attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )
    try:
        service.change_username(db, record.user, body.new_username, body.current_password)
    except service.InvalidCurrentPassword:
        service.login_throttle.record_failure(throttle_key)
        raise field_error(
            "current_password", "invalid_current_password", "Current password is incorrect"
        ) from None
    except service.UsernameUnchanged:
        raise field_error(
            "new_username", "username_unchanged", "That is already your username"
        ) from None
    except service.UsernameTaken:
        raise field_error("new_username", "username_taken", "That username is taken") from None
    service.login_throttle.reset(throttle_key)
    response.status_code = status.HTTP_204_NO_CONTENT
    _clear_session_cookies(response)
    return response


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: PasswordChangeRequest,
    response: Response,
    record: UserSession = Depends(get_current_session),  # session + CSRF + Origin
    db: Session = Depends(get_db),
) -> Response:
    """Change the signed-in user's password, then sign out everywhere.

    Wrong current passwords are throttled like logins. On failure the session is
    kept; on success every session is revoked and the cookies are cleared.
    """
    throttle_key = f"password-change:{record.user_id}"
    retry_after = service.login_throttle.retry_after(throttle_key)
    if retry_after:
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many failed attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )
    try:
        service.change_password(db, record.user, body.current_password, body.new_password)
    except service.InvalidCurrentPassword:
        service.login_throttle.record_failure(throttle_key)
        raise field_error(
            "current_password", "invalid_current_password", "Current password is incorrect"
        ) from None
    except service.PasswordReused:
        raise field_error(
            "new_password", "password_reused", "New password must differ from the current one"
        ) from None
    service.login_throttle.reset(throttle_key)
    response.status_code = status.HTTP_204_NO_CONTENT
    _clear_session_cookies(response)
    return response
