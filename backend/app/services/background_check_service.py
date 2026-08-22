"""신원조회 비즈니스 로직.

클라이언트를 인자로 받는다. 서비스가 직접 생성하지 않으므로
테스트에서 Fake를 주입할 수 있다.

외부 API의 상태 코드를 그대로 노출하지 않는다. 관리자가 외부 서비스 장애를
우리 시스템 장애로 오인하기 때문이다.
"""

import logging
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from fastapi import status as http_status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.external.base import (
    BackgroundCheckClient,
    CheckRequest,
    ExternalApiError,
    ExternalBadRequest,
    ExternalNotFound,
    ExternalServerError,
    ExternalTimeout,
    ExternalUnavailable,
)
from app.external.name_mapper import is_ambiguous, surname_candidates, to_external_name
from app.models import BackgroundCheck, CheckStatus, Employee, EmployeeStatus

logger = logging.getLogger(__name__)

UNAVAILABLE_MESSAGE = (
    "외부 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요"
)
TIMEOUT_MESSAGE = "외부 서비스 응답이 지연되고 있습니다"
BAD_REQUEST_MESSAGE = "직원 정보가 올바르지 않습니다"


def _to_http_error(exc: Exception) -> HTTPException:
    """외부 예외를 사용자에게 보여줄 응답으로 변환한다."""
    if isinstance(exc, ExternalTimeout):
        return HTTPException(http_status.HTTP_504_GATEWAY_TIMEOUT, TIMEOUT_MESSAGE)
    if isinstance(exc, ExternalBadRequest):
        return HTTPException(http_status.HTTP_400_BAD_REQUEST, BAD_REQUEST_MESSAGE)
    if isinstance(exc, (ExternalUnavailable, ExternalServerError, ExternalNotFound)):
        return HTTPException(
            http_status.HTTP_503_SERVICE_UNAVAILABLE, UNAVAILABLE_MESSAGE
        )
    return HTTPException(http_status.HTTP_503_SERVICE_UNAVAILABLE, UNAVAILABLE_MESSAGE)


async def request_check(
    db: AsyncSession,
    client: BackgroundCheckClient,
    target: Employee,
    admin: Employee,
    surname: str | None = None,
) -> BackgroundCheck:
    if target.status != EmployeeStatus.ACTIVE:
        raise HTTPException(
            http_status.HTTP_409_CONFLICT,
            "퇴사한 직원은 신원조회를 요청할 수 없습니다",
        )

    # 진행 중 조회 검사. 더블클릭과 재클릭을 막는 실질적 방어선이다.
    # 경쟁 조건까지 막는 선점 패턴은 쓰지 않기로 했다(발생 확률 대비 복잡도 초과).
    #
    # 창(requested_at 조건)이 있어야 한다. pending이 영원히 pending이면
    # (외부가 조회를 잃어버린 경우 등) 이 검사가 그 직원의 신규 조회를
    # 영원히 막는 교착이 된다. 창을 넘긴 pending은 진행 중으로 치지 않는다.
    window_start = datetime.now(UTC) - timedelta(
        seconds=settings.CHECK_IN_PROGRESS_WINDOW_SECONDS
    )
    in_progress = await db.scalar(
        select(BackgroundCheck).where(
            BackgroundCheck.employee_id == target.id,
            BackgroundCheck.status == CheckStatus.PENDING,
            BackgroundCheck.requested_at > window_start,
        )
    )
    if in_progress is not None:
        raise HTTPException(
            http_status.HTTP_409_CONFLICT, "이미 진행 중인 조회가 있습니다"
        )

    if surname is None and is_ambiguous(target.name):
        # 시스템이 추측하지 않는다. 관리자가 성을 확정해야 한다.
        # 프론트가 code로 분기할 수 있도록 구조화된 정보를 함께 반환한다.
        # FastAPI가 detail을 항상 "detail" 키 아래 감싸므로 안쪽 키는 message로 둔다.
        # 프론트는 error.detail.code로 분기한다.
        raise HTTPException(
            http_status.HTTP_409_CONFLICT,
            {
                "code": "AMBIGUOUS_SURNAME",
                "message": "성을 확정해 주세요",
                "name": target.name,
                "candidates": surname_candidates(target.name),
            },
        )

    try:
        first_name, last_name = to_external_name(target.name, surname)
    except ValueError as exc:
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    request = CheckRequest(
        employee_no=target.employee_no,
        first_name=first_name,
        last_name=last_name,
        date_of_birth=target.date_of_birth,
    )

    try:
        created = await client.create(request)
    except ExternalApiError as exc:
        # 외부 호출이 실패하면 아무것도 저장하지 않는다.
        # check_id가 NOT NULL이므로 응답을 받은 후에만 INSERT할 수 있다.
        logger.warning("신원조회 요청 실패: %s", exc)
        raise _to_http_error(exc) from exc

    check = BackgroundCheck(
        employee_id=target.id,
        check_id=created.check_id,
        status=created.status,
        sent_first_name=first_name,
        sent_last_name=last_name,
        completed_at=None,
        created_by=admin.id,
    )
    db.add(check)
    await db.commit()
    await db.refresh(check)
    return check


async def list_checks(
    db: AsyncSession, employee_id: int, page: int = 1, page_size: int = 10
) -> tuple[list[BackgroundCheck], int]:
    """이력 목록. (해당 페이지 항목, 전체 건수)를 반환한다.

    우리 DB만 조회하고 외부 API를 호출하지 않는다.
    대상의 재직 상태를 검사하지 않는다. 퇴사자의 과거 이력도 조회할 수 있어야 한다.

    requested_at 내림차순 고정이므로 진행 중인 조회는 항상 1페이지 맨 위에 온다.
    창 안의 pending은 중복 방지 때문에 동시에 하나뿐이다. 창을 넘긴 pending은
    여러 개 남을 수 있으나 진행 중으로 치지 않는다(in_progress=False).
    """
    total = await db.scalar(
        select(func.count())
        .select_from(BackgroundCheck)
        .where(BackgroundCheck.employee_id == employee_id)
    )
    stmt = (
        select(BackgroundCheck)
        .where(BackgroundCheck.employee_id == employee_id)
        .order_by(BackgroundCheck.requested_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list((await db.scalars(stmt)).all()), total or 0


def _needs_sync(check: BackgroundCheck) -> bool:
    """외부에 재확인이 필요한가.

    pending은 당연히 재확인 대상이다. 여기에 completed_at이 비어 있는 경우도 포함한다.
    POST가 곧바로 clear/flagged를 반환하는 경우가 있는데, 그 응답에는 세부 결과가
    담기지 않는다. pending만 동기화 대상으로 삼으면 이런 레코드는 세부 필드가
    영원히 NULL로 남는다.
    """
    return check.status == CheckStatus.PENDING or check.completed_at is None


async def get_check(
    db: AsyncSession, client: BackgroundCheckClient, background_check_id: int
) -> BackgroundCheck:
    check = await db.get(BackgroundCheck, background_check_id)
    if check is None:
        raise HTTPException(
            http_status.HTTP_404_NOT_FOUND, "조회 기록을 찾을 수 없습니다"
        )

    if not _needs_sync(check):
        return check

    try:
        # 시도는 1회뿐이다. 재시도 정책(503이면 retryAfter만큼 대기)을 그대로
        # 타면 이 GET 하나가 1분 가까이 걸려 프론트가 그동안 응답을 못 받는다.
        # 이 경로는 폴링(3초 간격)이 계속 다시 오므로 재시도 루프가 이미
        # 바깥에 있다. 안에서 또 버티는 것은 같은 일을 더 비싸게 반복하는
        # 것이다. 실패하면 아래에서 로컬 값을 반환하고 다음 폴링에 맡긴다.
        result = await client.get(check.check_id, attempts=1)
    except Exception as exc:  # noqa: BLE001  아래 주석 참조 — 의도적으로 넓게 잡는다
        # 동기화 실패가 조회 실패가 되면 안 된다.
        # 외부 API가 죽어도 과거 결과는 보여줄 수 있어야 한다는 것이
        # 결과를 DB에 저장한 이유다.
        logger.warning("pending 동기화 실패, 로컬 값을 반환한다: %s", exc)
        return check

    check.status = result.status
    check.criminal_record = result.criminal_record
    check.education_verified = result.education_verified
    check.employment_verified = result.employment_verified
    check.credit_score = result.credit_score
    check.completed_at = result.completed_at
    await db.commit()
    await db.refresh(check)
    return check
