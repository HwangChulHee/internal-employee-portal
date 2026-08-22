from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from app.models import EmployeeStatus, Role
from app.schemas.pagination import PageMeta


class MeResponse(BaseModel):
    """본인 정보 응답. password_hash는 여기에 정의하지 않으므로 절대 실려 나가지 않는다."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_no: str
    login_id: str
    name: str
    date_of_birth: date
    phone: str | None
    address: str | None
    department: str | None
    position: str | None
    role: Role
    status: EmployeeStatus


class MeUpdate(BaseModel):
    """직원 본인이 수정할 수 있는 필드만 정의한다.

    role, status, name, employee_no, date_of_birth, department, position은
    의도적으로 정의하지 않는다. 정의되지 않은 필드는 무시되므로
    이 스키마 자체가 필드 수준 인가의 방어선이다.
    """

    phone: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=200)


class EmployeeCreate(BaseModel):
    """직원 생성 요청.

    employee_no를 받지 않는다. 사번은 서버가 발급한다. 사람이 마지막 번호를 찾아
    다음 값을 계산할 일이 아니고, 형식이 강제되지 않으면 표기가 뒤섞인다.
    여기에 정의하지 않았으므로 요청에 담아 보내도 무시된다.

    login_id는 그대로 받는다. 사람이 기억하고 입력할 값이라 자동 생성이 부적절하다.

    비밀번호 필드도 받지 않는다. 초기 비밀번호는 서버가 고정값으로 설정한다.
    status도 정의하지 않는다. 생성 시점의 상태는 항상 ACTIVE다.
    """

    login_id: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=50)
    date_of_birth: date
    phone: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=200)
    department: str | None = Field(default=None, max_length=50)
    position: str | None = Field(default=None, max_length=50)
    role: Role = Role.EMPLOYEE


class EmployeeAdminUpdate(BaseModel):
    """관리자용 수정 요청.

    status를 넣지 않는다. 퇴사 처리는 세션 삭제가 함께 일어나야 하는 행위라
    별도 엔드포인트로 분리했고, 일반 필드 수정과 섞이면 안 된다.
    employee_no와 login_id도 넣지 않는다. 식별자 변경은 이 과제의 범위 밖이다.
    """

    name: str | None = Field(default=None, min_length=1, max_length=50)
    date_of_birth: date | None = None
    phone: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=200)
    department: str | None = Field(default=None, max_length=50)
    position: str | None = Field(default=None, max_length=50)
    role: Role | None = None


class EmployeeListItem(BaseModel):
    """목록용. 생년월일 등 민감한 필드를 싣지 않는다."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_no: str
    name: str
    department: str | None
    position: str | None
    status: EmployeeStatus


class EmployeePage(PageMeta):
    """직원 목록 페이지 응답."""

    items: list[EmployeeListItem]


class EmployeeDetail(BaseModel):
    """관리자용 상세."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_no: str
    login_id: str
    name: str
    date_of_birth: date
    phone: str | None
    address: str | None
    department: str | None
    position: str | None
    role: Role
    status: EmployeeStatus


class EmployeeCreated(EmployeeDetail):
    """생성 응답에만 초기 비밀번호를 얹는다.

    EmployeeDetail에 넣지 않는 이유: 조회·수정 응답에도 함께 실려 나가는데,
    그 시점에는 이미 직원이 바꿨을 수 있어 사실이 아닌 값이 된다.
    "방금 발급한 비밀번호"는 생성 순간에만 의미가 있다.
    """

    initial_password: str
