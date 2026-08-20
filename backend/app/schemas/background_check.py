from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import CheckStatus, CreditScore


class CheckCreateRequest(BaseModel):
    """신원조회 요청.

    surname은 복성 확정값이다. 이름이 모호하지 않으면 생략한다.
    시스템이 성을 추측하지 않고 관리자가 확정한다.
    """

    surname: str | None = Field(default=None, max_length=10)


class BackgroundCheckListItem(BaseModel):
    """이력 목록. 세부 결과 필드를 싣지 않는다.

    범죄이력·신용등급은 상세 조회에서만 노출한다.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    status: CheckStatus
    requested_at: datetime
    completed_at: datetime | None


class BackgroundCheckDetail(BaseModel):
    """상세. 세부 결과 4개 필드를 포함한다.

    결과 필드는 bool | None이다. null과 false는 다른 의미이므로
    Optional을 유지한다. pending이면 null이고, 이것을 "없음"으로
    표시하면 안 된다.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    status: CheckStatus
    # 외부 check_id는 URL에 노출하지 않고 응답 본문에만 담는다.
    check_id: str
    # 외부로 실제 전송한 이름. 복성 확정 결과가 여기 남는다.
    sent_first_name: str
    sent_last_name: str
    criminal_record: bool | None
    education_verified: bool | None
    employment_verified: bool | None
    credit_score: CreditScore | None
    requested_at: datetime
    completed_at: datetime | None
    created_by: int
