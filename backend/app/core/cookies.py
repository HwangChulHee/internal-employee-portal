"""세션 쿠키 설정과 삭제.

설정과 삭제의 속성이 하나라도 어긋나면 브라우저가 쿠키를 지우지 않는다.
두 함수를 떨어뜨려 두면 한쪽만 고치기 쉬우므로 한 파일에 둔다.

로그인·로그아웃(auth)과 비밀번호 변경(me) 세 곳에서 쓴다.
"""

from fastapi import Response

from app.config import settings

SESSION_COOKIE_NAME = "SESSIONID"


def set_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        session_id,
        httponly=True,  # JS 접근 차단 (XSS 방어)
        secure=settings.COOKIE_SECURE,  # 로컬 False, 배포 True
        samesite="lax",  # CSRF 방어
        max_age=settings.SESSION_MAX_AGE_SECONDS,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    """세션이 서버에서 삭제된 경우 브라우저에 남은 쿠키도 함께 지운다.

    속성이 설정 때와 같아야 브라우저가 같은 쿠키로 인식해 삭제한다.
    """
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
