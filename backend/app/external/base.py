"""외부 Background Check API의 계약.

외부 JSON의 camelCase가 서비스 계층으로 새어 나가지 않도록 dataclass로 감싼다.
HTTP 상태 코드도 여기서 도메인 예외로 변환한다. 서비스 계층은 httpx를 모른다.
"""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol

# --- 예외 -----------------------------------------------------------------
# 재시도 여부가 예외 종류로 드러나게 한다.


class ExternalApiError(Exception):
    """외부 API 호출 실패의 최상위 예외."""


class ExternalBadRequest(ExternalApiError):
    """400. 요청이 잘못되었으므로 재시도해도 결과가 같다."""


class ExternalNotFound(ExternalApiError):
    """404. 존재하지 않으므로 재시도해도 결과가 같다."""


class ExternalUnavailable(ExternalApiError):
    """503. 서버가 대기 시간을 명시했다."""

    def __init__(self, message: str, retry_after: int) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class ExternalServerError(ExternalApiError):
    """500. 일시적일 수 있다."""


class ExternalTimeout(ExternalApiError):
    """응답이 없다. 서버 상태를 알 수 없다는 점에서 500·503과 성격이 다르다."""


# --- 요청/응답 ------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CheckRequest:
    employee_no: str
    first_name: str
    last_name: str
    date_of_birth: date


@dataclass(frozen=True, slots=True)
class CheckCreated:
    """POST 응답. status는 pending일 수도, 바로 clear/flagged일 수도 있다."""

    check_id: str
    employee_no: str
    status: str
    created_at: datetime | None
    message: str | None = None


@dataclass(frozen=True, slots=True)
class CheckResult:
    """상세 조회 응답.

    결과 4개 필드는 완료 시에만 채워진다. None과 False는 다른 의미이므로
    bool | None을 유지한다.
    """

    check_id: str
    employee_no: str
    status: str
    criminal_record: bool | None
    education_verified: bool | None
    employment_verified: bool | None
    credit_score: str | None
    created_at: datetime | None
    completed_at: datetime | None


@dataclass(frozen=True, slots=True)
class CheckSummary:
    """목록 응답의 항목. 세부 결과 필드가 없다."""

    check_id: str
    status: str
    created_at: datetime | None
    completed_at: datetime | None


class BackgroundCheckClient(Protocol):
    async def create(self, req: CheckRequest) -> CheckCreated: ...

    async def get(
        self, check_id: str, *, attempts: int | None = None
    ) -> CheckResult: ...

    async def list_by_employee(self, employee_no: str) -> list[CheckSummary]: ...

    async def aclose(self) -> None: ...
