from datetime import date

from pydantic import BaseModel, ConfigDict, Field


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
    role: str
    status: str


class MeUpdate(BaseModel):
    """직원 본인이 수정할 수 있는 필드만 정의한다.

    role, status, name, employee_no, date_of_birth, department, position은
    의도적으로 정의하지 않는다. 정의되지 않은 필드는 무시되므로
    이 스키마 자체가 필드 수준 인가의 방어선이다.
    """

    phone: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=200)


class EmployeeListItem(BaseModel):
    """목록용. 생년월일 등 민감한 필드를 싣지 않는다."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_no: str
    name: str
    department: str | None
    position: str | None
    status: str


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
    role: str
    status: str
