import re
from datetime import date

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

MAX_MONTHS = 60
_MONTH = re.compile(r"^(19|20|21)\d\d-(0[1-9]|1[0-2])$")


def first_of(value: str) -> date:
    year, month = value.split("-")
    return date(int(year), int(month), 1)


def add_months(d: date, n: int) -> date:
    index = d.year * 12 + d.month - 1 + n
    return date(index // 12, index % 12 + 1, 1)


class MonthRange(BaseModel):
    """Inclusive UTC calendar months, "YYYY-MM". Default: the last 12 months."""

    model_config = ConfigDict(extra="forbid")

    start: str | None = Field(default=None, pattern=_MONTH.pattern)
    end: str | None = Field(default=None, pattern=_MONTH.pattern)

    @model_validator(mode="after")
    def ordered(self) -> "MonthRange":
        if self.start and self.end and first_of(self.start) > first_of(self.end):
            raise PydanticCustomError("range_reversed", "start is after end")
        if self.start and self.end and len(self.months()) > MAX_MONTHS:
            raise PydanticCustomError("range_too_long", "At most {max} months", {"max": MAX_MONTHS})
        return self

    def bounds(self, today: date) -> tuple[date, date]:
        end = first_of(self.end) if self.end else date(today.year, today.month, 1)
        start = first_of(self.start) if self.start else add_months(end, -11)
        return start, end

    def months(self, today: date | None = None) -> list[date]:
        start, end = self.bounds(today or date.today())
        out, current = [], start
        while current <= end:
            out.append(current)
            current = add_months(current, 1)
        return out


class Counts(BaseModel):
    counts: dict[str, int]
    total: int


class Summary(BaseModel):
    projects: dict[str, int]  # active / paused / closed
    active_projects: int
    reports: int
    notes: int


class MonthCount(BaseModel):
    month: str  # "YYYY-MM"
    count: int


class Timeline(BaseModel):
    months: list[MonthCount]
    total: int


class MonthAmount(BaseModel):
    month: str
    amount: str  # decimal as a string: never a float, never mixed with other currencies
    count: int


class CurrencySeries(BaseModel):
    currency: str
    total: str
    count: int
    months: list[MonthAmount]


class CurrencyTotal(BaseModel):
    currency: str
    total: str
    count: int


class Bounties(BaseModel):
    currencies: list[CurrencySeries]
    # Paid BBP reports in the range whose amount was not recorded (shown, not guessed).
    unpriced_paid: int
    # Amounts on BBP reports not (yet) marked Paid, any date: never part of earnings.
    unpaid: list[CurrencyTotal]
