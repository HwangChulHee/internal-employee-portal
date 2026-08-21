"""로그인·로그아웃 비즈니스 로직.

라우터는 HTTP 입출력만 다루고 실제 처리는 여기서 한다.
"""

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import (
    generate_session_id,
    session_expiry,
    verify_dummy_password,
    verify_password_async,
)
from app.models import Employee, EmployeeStatus
from app.models import Session as SessionModel

# 아이디가 없는 경우와 비밀번호가 틀린 경우를 구분하면 계정 존재 여부가 노출된다.
INVALID_CREDENTIALS = "아이디 또는 비밀번호가 올바르지 않습니다"
RESIGNED_ACCOUNT = "퇴사 처리된 계정입니다"


async def login(db: AsyncSession, login_id: str, password: str) -> SessionModel:
    employee = await db.scalar(select(Employee).where(Employee.login_id == login_id))

    if employee is None:
        # 계정이 없어도 동일한 비용의 해시 검증을 수행한다.
        # 이것이 없으면 응답 시간 차이만으로 계정 존재 여부를 알아낼 수 있다.
        await verify_dummy_password(password)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, INVALID_CREDENTIALS)

    if not await verify_password_async(password, employee.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, INVALID_CREDENTIALS)

    # 비밀번호 검증 이후에 확인한다. 순서를 바꾸면 비밀번호를 모르는 사람도
    # 퇴사자 계정의 존재를 확인할 수 있다.
    #
    # 이 검사가 없으면 퇴사자가 재로그인해 새 세션을 얻는다.
    # 퇴사 처리 트랜잭션으로는 막을 수 없는 경로이므로 반드시 필요하다.
    if employee.status != EmployeeStatus.ACTIVE:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, RESIGNED_ACCOUNT)

    # 별도 배치 없이 로그인 시점에 해당 사용자의 만료 세션을 정리한다.
    await db.execute(
        delete(SessionModel).where(
            SessionModel.employee_id == employee.id,
            SessionModel.expires_at < datetime.now(UTC),
        )
    )

    session = SessionModel(
        id=generate_session_id(),
        employee_id=employee.id,
        expires_at=session_expiry(settings.SESSION_MAX_AGE_SECONDS),
    )
    db.add(session)
    await db.commit()
    return session


async def logout(db: AsyncSession, session_id: str) -> None:
    await db.execute(delete(SessionModel).where(SessionModel.id == session_id))
    await db.commit()


async def delete_all_sessions(db: AsyncSession, employee_id: int) -> None:
    """해당 직원이 가진 모든 세션을 끊는다. 커밋하지 않는다.

    퇴사 처리, 비밀번호 변경, 비밀번호 초기화 세 곳에서 쓴다.
    셋 다 employees 변경과 같은 트랜잭션으로 묶여야 "상태는 바뀌었는데 세션은
    살아있는" 어긋난 상태가 생기지 않으므로, 커밋은 호출자에게 맡긴다.
    """
    await db.execute(
        delete(SessionModel).where(SessionModel.employee_id == employee_id)
    )
