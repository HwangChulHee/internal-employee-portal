from datetime import UTC, datetime, timedelta

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.config import settings
from app.models import CheckStatus, CreditScore
from app.schemas.pagination import PageMeta


class _InProgressMixin(BaseModel):
    """진행 중 판정을 서버가 계산해 내려준다.

    프론트가 같은 창(1시간)을 따로 들고 있으면 값이 어긋날 수 있어
    응답에 담는다. 진행 중 = 아직 완결되지 않았고(status pending이거나
    세부 동기화 전), 요청이 창 안에 있다. 창을 넘긴 조회는 화면에서
    "응답 없음"으로 표시되고 새 조회를 막지 않는다.

    저장 상태를 늘리지 않는 이유: 외부에는 실패 상태가 없어 "실패했다"는
    사실을 알 수 없고, 창을 넘긴 뒤에 완료될 수도 있다. 추측을 DB에
    기록하지 않고 매 응답 시점에 계산한다.
    """

    status: CheckStatus
    requested_at: datetime
    completed_at: datetime | None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def in_progress(self) -> bool:
        unresolved = self.status == CheckStatus.PENDING or self.completed_at is None
        fresh = datetime.now(UTC) - self.requested_at < timedelta(
            seconds=settings.CHECK_IN_PROGRESS_WINDOW_SECONDS
        )
        return unresolved and fresh


class CheckCreateRequest(BaseModel):
    """신원조회 요청.

    surname은 복성 확정값이다. 이름이 모호하지 않으면 생략한다.
    시스템이 성을 추측하지 않고 관리자가 확정한다.
    """

    surname: str | None = Field(default=None, max_length=10)


class BackgroundCheckListItem(_InProgressMixin):
    """이력 목록. 세부 결과 필드를 싣지 않는다.

    범죄이력·신용등급은 상세 조회에서만 노출한다.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int


class BackgroundCheckPage(PageMeta):
    """조회 이력 페이지 응답."""

    items: list[BackgroundCheckListItem]


class BackgroundCheckDetail(_InProgressMixin):
    """상세. 세부 결과 4개 필드를 포함한다.

    결과 필드는 bool | None이다. null과 false는 다른 의미이므로
    Optional을 유지한다. pending이면 null이고, 이것을 "없음"으로
    표시하면 안 된다.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    # 외부 check_id는 URL에 노출하지 않고 응답 본문에만 담는다.
    check_id: str
    # 외부로 실제 전송한 이름. 복성 확정 결과가 여기 남는다.
    sent_first_name: str
    sent_last_name: str
    criminal_record: bool | None
    education_verified: bool | None
    employment_verified: bool | None
    credit_score: CreditScore | None
    created_by: int
