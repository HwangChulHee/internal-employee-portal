from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cookies import clear_session_cookie
from app.core.deps import CurrentEmployee
from app.database import get_db
from app.schemas.auth import MessageResponse, PasswordChange
from app.schemas.employee import MeResponse, MeUpdate
from app.services import employee_service

router = APIRouter(prefix="/api/me", tags=["me"])


@router.get("", response_model=MeResponse)
async def read_me(employee: CurrentEmployee) -> MeResponse:
    return MeResponse.model_validate(employee)


@router.patch("", response_model=MeResponse)
async def update_me(
    payload: MeUpdate,
    employee: CurrentEmployee,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MeResponse:
    updated = await employee_service.update_me(db, employee, payload)
    return MeResponse.model_validate(updated)


@router.patch("/password", response_model=MessageResponse)
async def change_password(
    payload: PasswordChange,
    employee: CurrentEmployee,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MessageResponse:
    """본인 비밀번호 변경. 성공하면 이 요청을 보낸 세션도 함께 끊긴다."""
    await employee_service.change_password(
        db, employee, payload.current_password, payload.new_password
    )
    # 서버에서 세션을 지웠으므로 브라우저에 남은 쿠키도 지운다.
    # 남겨두면 다음 요청이 이미 없는 세션 ID를 들고 가 401을 받는다.
    clear_session_cookie(response)
    return MessageResponse(message="비밀번호가 변경되었습니다. 다시 로그인해 주세요.")
