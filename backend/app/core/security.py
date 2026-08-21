"""비밀번호 해싱과 세션 ID 생성.

passlib을 쓰지 않고 bcrypt를 직접 호출한다.
passlib 1.7.4는 2020년이 마지막 릴리스이고 bcrypt 5와 호환되지 않으며,
알고리즘을 하나만 쓰는 이 프로젝트에서는 추상화의 이점이 없다.
"""

import secrets
from datetime import UTC, datetime, timedelta

import bcrypt
from fastapi.concurrency import run_in_threadpool

# 존재하지 않는 계정에 대해서도 동일한 비용의 검증을 수행하기 위한 더미 해시.
# 이것이 없으면 응답 시간 차이로 계정 존재 여부가 드러난다.
_DUMMY_HASH = "$2b$12$Ly6tI5iibxwvOLSnz9Z.6OO.eaPaKKFHN.0/x6V/6uLapcmvgWaRe"

# 초기 비밀번호. 계정 생성, 관리자 초기화, 시드 세 곳에서 같은 값을 써야 하므로
# 여기 한 곳에만 정의한다.
#
# 로그인 아이디와 같은 값을 쓰지 않는다. 아이디와 동일한 비밀번호는 브라우저가
# 유출된 자격증명으로 판단해 경고를 띄우고, 아이디를 아는 사람이 곧 비밀번호를
# 아는 것과 같아 무차별 대입에도 취약하다.
INITIAL_PASSWORD = "bit1234"

# 비밀번호 최소 길이. 스키마 검증과 화면 안내가 같은 값을 봐야 하므로 여기서 정한다.
MIN_PASSWORD_LENGTH = 4


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        # 저장된 해시가 손상된 경우. 예외를 밖으로 흘리지 않고 인증 실패로 처리한다.
        return False


# bcrypt는 CPU 바운드다(cost 12 기준 호출당 약 180ms).
# async 라우터에서 직접 부르면 그 시간 동안 이벤트 루프가 멈춰
# 로그인과 무관한 다른 요청까지 함께 지연된다. 스레드풀로 넘긴다.
async def hash_password_async(plain: str) -> str:
    return await run_in_threadpool(hash_password, plain)


async def verify_password_async(plain: str, hashed: str) -> bool:
    return await run_in_threadpool(verify_password, plain, hashed)


async def verify_dummy_password(plain: str) -> None:
    """계정이 없을 때 호출한다. 성공하는 경로와 응답 시간을 맞추기 위한 것이다."""
    await run_in_threadpool(verify_password, plain, _DUMMY_HASH)


def generate_session_id() -> str:
    """세션 ID는 추측 불가능해야 하므로 uuid4가 아니라 secrets를 쓴다."""
    return secrets.token_urlsafe(32)


def session_expiry(max_age_seconds: int) -> datetime:
    """세션 만료 시각. 비교 시 오류가 나지 않도록 timezone-aware로 만든다."""
    return datetime.now(UTC) + timedelta(seconds=max_age_seconds)
