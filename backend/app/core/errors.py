"""One error shape for every API response that is not a success.

    {"detail": "<English message>", "code": "<machine code>", "errors": [<field errors>]}

`detail` is for logs and developers; the frontend translates `code` and the
field error codes. `errors` is present only for validation failures.
"""

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import InterfaceError, OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("hexops")

DEFAULT_CODES = {
    400: "bad_request",
    401: "not_authenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    422: "validation_error",
    429: "rate_limited",
    500: "internal_error",
    503: "service_unavailable",
}


class FieldError(BaseModel):
    field: str
    code: str
    params: dict[str, str | int | float | bool] = {}


class ErrorBody(BaseModel):
    detail: str
    code: str
    errors: list[FieldError] | None = None


def api_error(
    status_code: int, code: str, message: str, headers: dict[str, str] | None = None
) -> HTTPException:
    """Build an HTTPException carrying a stable error code: `raise api_error(...)`."""
    return HTTPException(status_code, detail={"code": code, "message": message}, headers=headers)


def field_error(field: str, code: str, message: str) -> HTTPException:
    """A 422 that points at one field, shaped like request validation errors:
    `raise field_error("current_password", "invalid_current_password", "...")`.
    """
    return HTTPException(
        422,
        detail={
            "code": "validation_error",
            "message": message,
            "errors": [FieldError(field=field, code=code).model_dump()],
        },
    )


def _body(code: str, message: str, errors: list[FieldError] | None = None):
    return ErrorBody(detail=message, code=code, errors=errors).model_dump(exclude_none=True)


def _field_errors(exc: RequestValidationError) -> list[FieldError]:
    out = []
    for err in exc.errors():
        # Drop the "body"/"query" prefix; keep the field path. The rejected input is
        # never echoed back, since it may be a password.
        loc = [str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path")]
        ctx = err.get("ctx") or {}
        params = {k: v for k, v in ctx.items() if isinstance(v, str | int | float | bool)}
        out.append(FieldError(field=".".join(loc), code=err.get("type", "invalid"), params=params))
    return out


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        errors = None
        if isinstance(exc.detail, dict):
            code, message = exc.detail["code"], exc.detail["message"]
            if "errors" in exc.detail:
                errors = [FieldError(**e) for e in exc.detail["errors"]]
        else:
            code = DEFAULT_CODES.get(exc.status_code, "error")
            message = str(exc.detail)
        return JSONResponse(_body(code, message, errors), exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        body = _body("validation_error", "Request validation failed", _field_errors(exc))
        return JSONResponse(body, 422)

    @app.exception_handler(OperationalError)
    @app.exception_handler(InterfaceError)
    async def database_down(request: Request, exc: Exception) -> JSONResponse:
        # Lost or refused DB connections are an outage, not a bug: say so, without details.
        logger.error("Database unavailable on %s %s", request.method, request.url.path)
        return JSONResponse(_body("database_unavailable", "Database unreachable"), 503)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Log the type and route only; exception messages can contain user data.
        logger.error("Unhandled %s on %s %s", type(exc).__name__, request.method, request.url.path)
        return JSONResponse(_body("internal_error", "Internal server error"), 500)
