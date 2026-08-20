"""실패 재현용 가짜 클라이언트.

재시도·백오프 코드는 개발 중에 503이 발생하지 않으면 한 번도 실행되지 않은 채
배포된다. 그 경로를 의도적으로 재현하기 위한 것이다.

**HttpClient를 그대로 쓰고 transport만 바꾼다.** 별도 구현체로 만들면
재시도 로직이 두 벌이 되고, Fake로 검증한 경로가 실제 경로와 달라져
검증의 의미가 사라진다. 여기서 확인한 재시도 동작은 실제 호출에서도 동일하다.
"""

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx

from app.external.http_client import HttpClient

FAKE_MODES = (
    "normal",
    "always_503",
    "always_500",
    "timeout",
    "always_pending",
    "fail_then_succeed",
    "always_400",
    "always_404",
)

# 기본값(5초)과 구분되는 값을 써서, 코드가 응답의 retryAfter를 실제로
# 읽는지 로그로 확인할 수 있게 한다.
_FAKE_RETRY_AFTER = 2


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _error(status: int, message: str, **extra: Any) -> httpx.Response:
    body = {"error": message, "message": message, "statusCode": status, **extra}
    return httpx.Response(status, json=body)


class _FakeBackend:
    """모드별 응답을 만든다. always_pending과 fail_then_succeed는 상태를 들고 있어야 한다."""

    def __init__(self, mode: str) -> None:
        self.mode = mode
        self.attempts = 0
        self.checks: dict[str, dict[str, Any]] = {}
        self.by_employee: dict[str, list[str]] = {}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.attempts += 1

        failure = self._failure_response()
        if failure is not None:
            return failure

        if request.method == "POST":
            return self._create(request)
        if request.url.path.rstrip("/").endswith("background-checks"):
            return self._list(request)
        return self._detail(request)

    def _failure_response(self) -> httpx.Response | None:
        if self.mode == "always_503":
            return _error(503, "Service Unavailable", retryAfter=_FAKE_RETRY_AFTER)
        if self.mode == "always_500":
            return _error(500, "Internal Server Error")
        if self.mode == "always_400":
            return _error(400, "Bad Request")
        if self.mode == "always_404":
            return _error(404, "Not Found")
        if self.mode == "timeout":
            raise httpx.ReadTimeout("가짜 타임아웃", request=None)
        if self.mode == "fail_then_succeed" and self.attempts <= 2:
            # 2회 실패 후 성공. 재시도로 복구되는 경로를 확인한다.
            return _error(503, "Service Unavailable", retryAfter=_FAKE_RETRY_AFTER)
        return None

    def _create(self, request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        check_id = f"CHK-{uuid.uuid4()}"
        status = "pending" if self.mode == "always_pending" else "clear"
        created = _now()

        record: dict[str, Any] = {
            "checkId": check_id,
            "employeeId": payload["employeeId"],
            "firstName": payload["firstName"],
            "lastName": payload["lastName"],
            "dateOfBirth": payload["dateOfBirth"],
            "status": status,
            "createdAt": created,
            "completedAt": None if status == "pending" else created,
            "criminalRecord": None if status == "pending" else False,
            "educationVerified": None if status == "pending" else True,
            "employmentVerified": None if status == "pending" else True,
            "creditScore": None if status == "pending" else "good",
        }
        self.checks[check_id] = record
        self.by_employee.setdefault(payload["employeeId"], []).append(check_id)

        return httpx.Response(
            201,
            json={
                "checkId": check_id,
                "employeeId": payload["employeeId"],
                "status": status,
                "createdAt": created,
                "message": "가짜 클라이언트 응답",
            },
        )

    def _detail(self, request: httpx.Request) -> httpx.Response:
        check_id = request.url.path.rsplit("/", 1)[-1]
        record = self.checks.get(check_id)
        if record is None:
            return _error(404, "Not Found")
        return httpx.Response(200, json=record)

    def _list(self, request: httpx.Request) -> httpx.Response:
        employee_no = request.url.params.get("employeeId")
        if not employee_no:
            return _error(400, "employeeId is required")
        ids = self.by_employee.get(employee_no, [])
        return httpx.Response(
            200,
            json={
                "employeeId": employee_no,
                "checks": [
                    {
                        "checkId": cid,
                        "status": self.checks[cid]["status"],
                        "createdAt": self.checks[cid]["createdAt"],
                        "completedAt": self.checks[cid]["completedAt"],
                    }
                    for cid in ids
                ],
                "totalCount": len(ids),
            },
        )


def build_fake_client(mode: str) -> HttpClient:
    if mode not in FAKE_MODES:
        raise ValueError(f"알 수 없는 FAKE_MODE: {mode}. 가능한 값: {FAKE_MODES}")
    backend = _FakeBackend(mode)
    transport = httpx.MockTransport(backend)
    client = httpx.AsyncClient(
        transport=transport, base_url="http://fake-background-check"
    )
    return HttpClient(client)
