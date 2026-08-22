"""신원조회 API.

전부 관리자 전용이다. 범죄이력과 신용등급이 포함된 가장 민감한 데이터이며,
요구사항이 "관리자가 볼 수 있도록"이라고 명시했으므로 직원 본인도 접근할 수 없다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AdminEmployee
from app.database import get_db
from app.external.base import BackgroundCheckClient
from app.external.deps import get_check_client
from app.models import BackgroundCheck
from app.schemas.background_check import (
    BackgroundCheckDetail,
    BackgroundCheckPage,
    CheckCreateRequest,
)
from app.services import background_check_service, employee_service

# 직원 하위 경로. 경로 파라미터는 {employee_id}로 통일한다.
employee_router = APIRouter(prefix="/api/employees", tags=["background-checks"])

# 조회 기록 자체를 가리키는 경로. 내부 PK를 쓰며 외부 check_id는 URL에 노출하지 않는다.
check_router = APIRouter(prefix="/api/background-checks", tags=["background-checks"])


@employee_router.post(
    "/{employee_id}/background-checks",
    response_model=BackgroundCheckDetail,
    status_code=status.HTTP_201_CREATED,
)
async def request_background_check(
    employee_id: int,
    payload: CheckCreateRequest,
    admin: AdminEmployee,
    db: Annotated[AsyncSession, Depends(get_db)],
    client: Annotated[BackgroundCheckClient, Depends(get_check_client)],
) -> BackgroundCheck:
    target = await employee_service.get_employee(db, employee_id)
    return await background_check_service.request_check(
        db, client, target, admin, payload.surname
    )


@employee_router.get(
    "/{employee_id}/background-checks",
    response_model=BackgroundCheckPage,
)
async def list_background_checks(
    employee_id: int,
    admin: AdminEmployee,
    db: Annotated[AsyncSession, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 10,
) -> BackgroundCheckPage:
    # 대상이 존재하는지는 확인하되, 재직 상태는 보지 않는다.
    # 퇴사자의 과거 이력도 조회할 수 있어야 한다.
    await employee_service.get_employee(db, employee_id)
    items, total = await background_check_service.list_checks(
        db, employee_id, page=page, page_size=page_size
    )
    return BackgroundCheckPage(items=items, total=total, page=page, page_size=page_size)


@check_router.get("/{background_check_id}", response_model=BackgroundCheckDetail)
async def get_background_check(
    background_check_id: int,
    admin: AdminEmployee,
    db: Annotated[AsyncSession, Depends(get_db)],
    client: Annotated[BackgroundCheckClient, Depends(get_check_client)],
) -> BackgroundCheck:
    # pending 동기화가 여기서 일어난다.
    return await background_check_service.get_check(db, client, background_check_id)
