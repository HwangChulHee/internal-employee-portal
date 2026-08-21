from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cookies import (
    SESSION_COOKIE_NAME,
    clear_session_cookie,
    set_session_cookie,
)
from app.core.deps import CurrentEmployee
from app.core.security import INITIAL_PASSWORD, MIN_PASSWORD_LENGTH
from app.database import get_db
from app.schemas.auth import LoginRequest, MessageResponse, PasswordPolicy
from app.services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=MessageResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MessageResponse:
    session = await auth_service.login(db, payload.login_id, payload.password)
    set_session_cookie(response, session.id)
    return MessageResponse(message="로그인되었습니다")


@router.post("/logout", response_model=MessageResponse)
async def logout(
    response: Response,
    employee: CurrentEmployee,
    db: Annotated[AsyncSession, Depends(get_db)],
    session_id: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
) -> MessageResponse:
    if session_id:
        await auth_service.logout(db, session_id)
    clear_session_cookie(response)
    return MessageResponse(message="로그아웃되었습니다")


@router.get("/password-policy", response_model=PasswordPolicy)
async def password_policy(employee: CurrentEmployee) -> PasswordPolicy:
    """화면이 안내 문구와 클라이언트 검증에 쓸 값.

    인증을 요구한다. 초기 비밀번호를 공개하면 모든 신규 계정의 첫 비밀번호를
    누구나 알게 된다. 추측하기 쉬운 값이라도 대놓고 알려줄 이유는 없다.
    """
    return PasswordPolicy(
        initial_password=INITIAL_PASSWORD,
        min_length=MIN_PASSWORD_LENGTH,
    )
