"""관리자용 직원 CRUD와 퇴사 처리.

권한은 Depends로 선언한다. 라우터 함수 안에서 role을 보고 분기하지 않는다.
시그니처만 보아도 누가 접근할 수 있는지 드러나야 한다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AdminEmployee, require_self_or_admin
from app.database import get_db
from app.models import Employee, EmployeeStatus
from app.schemas.employee import (
    EmployeeAdminUpdate,
    EmployeeCreate,
    EmployeeDetail,
    EmployeeListItem,
)
from app.services import employee_service

router = APIRouter(prefix="/api/employees", tags=["employees"])


@router.get("", response_model=list[EmployeeListItem])
async def list_employees(
    admin: AdminEmployee,
    db: Annotated[AsyncSession, Depends(get_db)],
    status_filter: Annotated[
        EmployeeStatus | None,
        Query(alias="status", description="재직 상태 필터. 미지정 시 전체"),
    ] = None,
    q: Annotated[str | None, Query(description="이름 또는 사번 부분 검색")] = None,
) -> list[Employee]:
    return await employee_service.list_employees(db, status=status_filter, q=q)


@router.post("", response_model=EmployeeDetail, status_code=status.HTTP_201_CREATED)
async def create_employee(
    payload: EmployeeCreate,
    admin: AdminEmployee,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Employee:
    return await employee_service.create_employee(db, payload)


@router.get("/{employee_id}", response_model=EmployeeDetail)
async def get_employee(
    employee_id: int,
    requester: Annotated[Employee, Depends(require_self_or_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Employee:
    # 조회 대상의 재직 상태는 보지 않는다. 관리자는 퇴사자도 조회할 수 있어야 한다.
    return await employee_service.get_employee(db, employee_id)


@router.patch("/{employee_id}", response_model=EmployeeDetail)
async def update_employee(
    employee_id: int,
    payload: EmployeeAdminUpdate,
    admin: AdminEmployee,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Employee:
    target = await employee_service.get_employee(db, employee_id)
    employee_service.ensure_not_self_demotion(target, admin, payload.role)
    return await employee_service.update_employee(db, target, payload)


@router.post("/{employee_id}/resign", response_model=EmployeeDetail)
async def resign_employee(
    employee_id: int,
    admin: AdminEmployee,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Employee:
    target = await employee_service.get_employee(db, employee_id)
    employee_service.ensure_not_self_resign(target, admin)
    employee_service.ensure_not_already_resigned(target)
    return await employee_service.resign_employee(db, target)
