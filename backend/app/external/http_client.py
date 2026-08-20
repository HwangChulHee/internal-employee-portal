"""외부 Background Check API의 HTTP 구현체.

재시도 정책이 여기 한곳에 있다. Fake 구현체는 이 클래스를 그대로 쓰고
transport만 바꾸므로, Fake로 검증한 재시도 경로가 실제 경로와 동일하다.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.config import settings
from app.external.base import (
    CheckCreated,
    CheckRequest,
    CheckResult,
    CheckSummary,
    ExternalApiError,
    ExternalBadRequest,
    ExternalNotFound,
    ExternalServerError,
    ExternalTimeout,
    ExternalUnavailable,
)

logger = logging.getLogger(__name__)

_CHECKS_PATH = "/background-checks"

# POST 타임아웃 후 "방금 생성된 것"으로 간주할 시간 범위.
_RECENT_WINDOW_SECONDS = 30


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    # 외부는 "2026-08-20T03:30:19.202Z" 형식을 쓴다.
    # Python 3.11+의 fromisoformat이 Z 접미사를 그대로 처리한다.
    return datetime.fromisoformat(value)


class HttpClient:
    def __init__(self, client: httpx.AsyncClient) -> None:
        # AsyncClient는 앱 수명 동안 재사용한다. 요청마다 만들면 커넥션 풀이 무의미하다.
        self._client = client

    async def aclose(self) -> None:
        await self._client.aclose()

    # --- 재시도 ------------------------------------------------------------

    async def _request(
        self,
        method: str,
        url: str,
        *,
        retry_on_timeout: bool,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """재시도를 포함한 요청.

        재시도해서 결과가 달라질 수 있는 것만 재시도한다.
        400과 404는 반복해도 같은 답이므로 즉시 예외를 던진다.

        retry_on_timeout은 멱등한 요청(GET)에만 True로 준다.
        POST는 서버 상태를 알 수 없어 여기서 재시도하지 않고, create()가
        "이미 생성되었는지 확인" 절차를 거친다.
        """
        max_attempts = settings.EXTERNAL_MAX_RETRIES
        last_error: Exception | None = None

        for attempt in range(1, max_attempts + 1):
            try:
                response = await self._client.request(
                    method, url, json=json, params=params
                )
            except httpx.TimeoutException as exc:
                last_error = ExternalTimeout(f"{method} {url} 타임아웃")
                logger.warning(
                    "외부 API 타임아웃 (%s/%s) %s %s",
                    attempt,
                    max_attempts,
                    method,
                    url,
                )
                if not retry_on_timeout or attempt == max_attempts:
                    raise last_error from exc
                await self._sleep_backoff(attempt)
                continue

            status = response.status_code

            # 재시도해도 결과가 달라지지 않는 것들. 즉시 중단한다.
            if status == 400:
                logger.warning("외부 API 400 (재시도 안 함) %s %s", method, url)
                raise ExternalBadRequest(_error_message(response))
            if status == 404:
                logger.warning("외부 API 404 (재시도 안 함) %s %s", method, url)
                raise ExternalNotFound(_error_message(response))

            if status == 503:
                # 503만 응답 스키마가 다르다. 서버가 알려준 대기 시간을 존중한다.
                retry_after = _retry_after(response)
                last_error = ExternalUnavailable(_error_message(response), retry_after)
                logger.warning(
                    "외부 API 503 (%s/%s) retryAfter=%ss",
                    attempt,
                    max_attempts,
                    retry_after,
                )
                if attempt == max_attempts:
                    raise last_error
                await asyncio.sleep(retry_after)
                continue

            if status >= 500:
                last_error = ExternalServerError(_error_message(response))
                logger.warning("외부 API %s (%s/%s)", status, attempt, max_attempts)
                if attempt == max_attempts:
                    raise last_error
                await self._sleep_backoff(attempt)
                continue

            if status >= 400:
                raise ExternalBadRequest(_error_message(response))

            return response.json()

        # 도달하지 않는다. 루프 안에서 반환하거나 예외를 던진다.
        raise last_error or ExternalServerError("외부 API 호출에 실패했습니다")

    async def _sleep_backoff(self, attempt: int) -> None:
        """지수 백오프. 대기 시간 정보가 없을 때 쓴다.

        같은 간격으로 반복 호출하면 부하 상태인 서버를 더 악화시킨다.
        """
        wait = settings.EXTERNAL_BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
        logger.info("백오프 %ss 대기 후 재시도", wait)
        await asyncio.sleep(wait)

    # --- Protocol 구현 -----------------------------------------------------

    async def create(self, req: CheckRequest) -> CheckCreated:
        payload = {
            "employeeId": req.employee_no,
            "firstName": req.first_name,
            "lastName": req.last_name,
            "dateOfBirth": req.date_of_birth.isoformat(),
        }
        try:
            data = await self._request(
                "POST", _CHECKS_PATH, json=payload, retry_on_timeout=False
            )
        except ExternalTimeout:
            # 타임아웃은 서버 상태를 알 수 없다. 바로 재시도하면 중복 생성 위험이 있다.
            #
            # 완화 조치일 뿐 완전한 해결이 아니다. 확인하는 순간에도 서버가
            # 처리 중일 수 있다. 이 API에 멱등성 키가 없어 근본 해결이 불가능하다.
            logger.warning("POST 타임아웃 — 이미 생성되었는지 확인 후 재시도한다")
            await asyncio.sleep(2)
            recent = await self._find_recent(req.employee_no)
            if recent is not None:
                logger.info("최근 생성된 조회를 재사용한다: %s", recent.check_id)
                return CheckCreated(
                    check_id=recent.check_id,
                    employee_no=req.employee_no,
                    status=recent.status,
                    created_at=recent.created_at,
                    message="타임아웃 후 기존 요청을 재사용했습니다",
                )
            data = await self._request(
                "POST", _CHECKS_PATH, json=payload, retry_on_timeout=False
            )

        return CheckCreated(
            check_id=data["checkId"],
            employee_no=data.get("employeeId", req.employee_no),
            status=data["status"],
            created_at=_parse_dt(data.get("createdAt")),
            message=data.get("message"),
        )

    async def _find_recent(self, employee_no: str) -> CheckSummary | None:
        """타임아웃 직전에 생성된 것으로 보이는 조회를 찾는다."""
        try:
            existing = await self.list_by_employee(employee_no)
        except ExternalApiError:
            # 확인 자체가 실패하면 확인하지 않은 것과 같다. 재시도로 넘어간다.
            logger.warning("생성 여부 확인에 실패했다. 재시도로 진행한다")
            return None

        cutoff = datetime.now(UTC) - timedelta(seconds=_RECENT_WINDOW_SECONDS)
        recent = [c for c in existing if c.created_at and c.created_at >= cutoff]
        if not recent:
            return None
        return max(recent, key=lambda c: c.created_at)

    async def get(self, check_id: str) -> CheckResult:
        data = await self._request(
            "GET", f"{_CHECKS_PATH}/{check_id}", retry_on_timeout=True
        )
        return CheckResult(
            check_id=data["checkId"],
            employee_no=data.get("employeeId", ""),
            status=data["status"],
            criminal_record=data.get("criminalRecord"),
            education_verified=data.get("educationVerified"),
            employment_verified=data.get("employmentVerified"),
            credit_score=data.get("creditScore"),
            created_at=_parse_dt(data.get("createdAt")),
            completed_at=_parse_dt(data.get("completedAt")),
        )

    async def list_by_employee(self, employee_no: str) -> list[CheckSummary]:
        data = await self._request(
            "GET",
            _CHECKS_PATH,
            params={"employeeId": employee_no},
            retry_on_timeout=True,
        )
        # 응답이 배열이 아니라 {"employeeId":..., "checks":[...], "totalCount":N} 래퍼다.
        return [
            CheckSummary(
                check_id=item["checkId"],
                status=item["status"],
                created_at=_parse_dt(item.get("createdAt")),
                completed_at=_parse_dt(item.get("completedAt")),
            )
            for item in data.get("checks", [])
        ]


def _retry_after(response: httpx.Response) -> int:
    try:
        value = response.json().get("retryAfter")
    except ValueError:
        value = None
    if isinstance(value, int) and value > 0:
        return value
    return settings.EXTERNAL_DEFAULT_RETRY_AFTER


def _error_message(response: httpx.Response) -> str:
    try:
        return str(response.json().get("message", response.text))
    except ValueError:
        return response.text
