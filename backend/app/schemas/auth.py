from pydantic import BaseModel, Field

from app.core.security import MIN_PASSWORD_LENGTH


class LoginRequest(BaseModel):
    login_id: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1)


class PasswordChange(BaseModel):
    """직원 본인의 비밀번호 변경 요청.

    현재 비밀번호를 함께 받는다. 세션만으로 변경을 허용하지 않는다는 정책이
    스키마에 드러난다.

    최소 길이는 새 비밀번호에만 건다. 현재 비밀번호는 정책이 바뀌기 전에
    발급된 짧은 값일 수 있고, 어차피 해시 대조로 판정되므로 길이를 강제하면
    "형식은 맞는데 틀림"과 "형식부터 틀림"이 다른 상태 코드로 갈린다.
    """

    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH)


class PasswordPolicy(BaseModel):
    """화면이 안내 문구와 클라이언트 검증에 쓰는 값.

    프론트가 초기 비밀번호와 최소 길이를 직접 적어두면 백엔드와 어긋날 수 있어
    서버에서 내려준다. 인증된 사용자만 볼 수 있다.
    """

    initial_password: str
    min_length: int


class MessageResponse(BaseModel):
    message: str
