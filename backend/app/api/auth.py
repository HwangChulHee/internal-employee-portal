from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import SESSION_COOKIE_NAME, CurrentEmployee
from app.database import get_db
from app.schemas.auth import LoginRequest, MessageResponse
from app.services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        session_id,
        httponly=True,  # JS 접근 차단 (XSS 방어)
        secure=settings.COOKIE_SECURE,  # 로컬 False, 배포 True
        samesite="lax",  # CSRF 방어
        max_age=settings.SESSION_MAX_AGE_SECONDS,
        path="/",
    )


@router.post("/login", response_model=MessageResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MessageResponse:
    session = await auth_service.login(db, payload.login_id, payload.password)
    _set_session_cookie(response, session.id)
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
    # 삭제 시 속성이 설정 때와 맞아야 브라우저가 쿠키를 지운다.
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    return MessageResponse(message="로그아웃되었습니다")
