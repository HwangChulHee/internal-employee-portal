"""인증·인가 의존성.

원칙: 세션에서는 employee_id만 꺼내고, role과 status는 매 요청 employees에서
최신 값을 조회한다. 세션에 캐싱하면 로그인 시점의 스냅샷이 되어
퇴사·권한 변경이 반영되지 않는다.
"""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Employee, EmployeeStatus, Role
from app.models import Session as SessionModel

SESSION_COOKIE_NAME = "SESSIONID"


async def get_current_employee(
    db: Annotated[AsyncSession, Depends(get_db)],
    session_id: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
) -> Employee:
    if not session_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "로그인이 필요합니다")

    # 세션과 직원 정보를 조인 한 번으로 가져온다. DB 왕복은 1회다.
    # outer join을 쓰는 이유: inner join이면 "세션 없음"과 "직원 레코드 없음"이
    # 똑같이 0행으로 나와 구분할 수 없다. 두 상황은 응답 메시지가 다르다.
    stmt = (
        select(SessionModel, Employee)
        .outerjoin(Employee, Employee.id == SessionModel.employee_id)
        .where(SessionModel.id == session_id)
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "세션이 만료되었습니다")

    session, employee = row
    if employee is None:
        # FK가 ON DELETE CASCADE라 정상 경로에서는 발생하지 않지만,
        # 수동 삭제 등으로 어긋난 경우를 대비한 방어 코드다.
        await db.execute(delete(SessionModel).where(SessionModel.id == session.id))
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "유효하지 않은 계정입니다")

    if session.expires_at < datetime.now(UTC):
        # 만료된 세션은 그 자리에서 정리한다.
        await db.execute(delete(SessionModel).where(SessionModel.id == session.id))
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "세션이 만료되었습니다")

    if employee.status != EmployeeStatus.ACTIVE:
        # 퇴사자를 발견하면 해당 직원의 세션을 모두 삭제한다.
        # 다음 요청부터는 세션 조회 단계에서 걸러진다.
        await db.execute(
            delete(SessionModel).where(SessionModel.employee_id == employee.id)
        )
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "퇴사 처리된 계정입니다")

    return employee


CurrentEmployee = Annotated[Employee, Depends(get_current_employee)]


async def require_admin(employee: CurrentEmployee) -> Employee:
    if employee.role != Role.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "권한이 없습니다")
    return employee


AdminEmployee = Annotated[Employee, Depends(require_admin)]


async def require_self_or_admin(
    employee_id: int, employee: CurrentEmployee
) -> Employee:
    """경로 파라미터 employee_id를 가진 라우터에서 쓴다. 본인이거나 관리자여야 한다."""
    if employee.id != employee_id and employee.role != Role.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "권한이 없습니다")
    return employee
