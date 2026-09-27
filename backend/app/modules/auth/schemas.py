from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator
from pydantic_core import PydanticCustomError

from app.core.security import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH

USERNAME_PATTERN = r"^[A-Za-z0-9_.-]{3,64}$"


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)

    username: str = Field(pattern=USERNAME_PATTERN)
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    last_login_at: datetime | None


class SessionOut(BaseModel):
    user: UserOut
    expires_at: datetime


class SetupStatus(BaseModel):
    required: bool


class SetupRequest(BaseModel):
    """First-run owner account. The confirmation is checked here too, not only in the UI."""

    model_config = ConfigDict(extra="forbid")

    username: str = Field(pattern=USERNAME_PATTERN)
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)
    password_confirm: str = Field(max_length=MAX_PASSWORD_LENGTH)

    @field_validator("password_confirm")
    @classmethod
    def passwords_match(cls, value: str, info: ValidationInfo) -> str:
        if "password" in info.data and value != info.data["password"]:
            raise PydanticCustomError("password_mismatch", "Passwords do not match")
        return value


class UsernameChangeRequest(BaseModel):
    """Settings → Account. The format is checked here; the current password, "unchanged"
    and uniqueness are checked in the service, against the stored account."""

    model_config = ConfigDict(extra="forbid")

    new_username: str = Field(pattern=USERNAME_PATTERN)
    current_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class PasswordChangeRequest(BaseModel):
    """Settings → Security. Length and confirmation are checked here; the current
    password and reuse are checked in the router, against the stored hash."""

    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)
    new_password_confirm: str = Field(max_length=MAX_PASSWORD_LENGTH)

    @field_validator("new_password_confirm")
    @classmethod
    def passwords_match(cls, value: str, info: ValidationInfo) -> str:
        if "new_password" in info.data and value != info.data["new_password"]:
            raise PydanticCustomError("password_mismatch", "Passwords do not match")
        return value
