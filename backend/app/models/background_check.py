from datetime import datetime
from enum import Enum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.employee import _sql_values


class CheckStatus(str, Enum):
    PENDING = "pending"
    CLEAR = "clear"
    # "불합격"이 아니라 "추가 검토 필요"를 뜻한다. 자의적으로 재해석하지 않는다.
    FLAGGED = "flagged"


class CreditScore(str, Enum):
    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"


class BackgroundCheck(Base):
    """외부 신원조회 요청·결과의 사본.

    외부 API가 진실의 원천이고 이 테이블은 사본이다.
    외부 API가 응답하지 않아도 과거 결과를 조회할 수 있어야 하므로 저장한다.
    """

    __tablename__ = "background_checks"
    __table_args__ = (
        CheckConstraint(
            f"status IN ({_sql_values(CheckStatus)})", name="ck_checks_status"
        ),
        CheckConstraint(
            f"credit_score IS NULL OR credit_score IN ({_sql_values(CreditScore)})",
            name="ck_checks_credit",
        ),
        Index("idx_checks_employee", "employee_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    # 조회 대상 직원
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), nullable=False)

    # 외부 API가 발급한 checkId. 응답을 받은 후에만 INSERT하므로 NOT NULL이다.
    check_id: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)

    status: Mapped[str] = mapped_column(String(10), nullable=False)

    # 외부로 실제 전송한 이름. 감사·추적 목적.
    sent_first_name: Mapped[str] = mapped_column(String(50), nullable=False)
    sent_last_name: Mapped[str] = mapped_column(String(50), nullable=False)

    # 완료 시에만 채워진다. pending이면 NULL.
    # NULL과 false는 다른 의미다. UI에서 NULL을 "없음"으로 표시하지 않도록 주의한다.
    criminal_record: Mapped[bool | None] = mapped_column(Boolean)
    education_verified: Mapped[bool | None] = mapped_column(Boolean)
    employment_verified: Mapped[bool | None] = mapped_column(Boolean)
    credit_score: Mapped[str | None] = mapped_column(String(10))

    # 우리 시스템이 요청한 시각
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # 외부 API의 completedAt. pending이면 NULL.
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # 요청한 관리자. 민감정보 접근 기록으로서 최소한의 감사 추적을 남긴다.
    created_by: Mapped[int] = mapped_column(ForeignKey("employees.id"), nullable=False)

    # employees를 두 번 참조하므로 foreign_keys를 명시해야 모호성 오류가 나지 않는다.
    employee: Mapped["Employee"] = relationship(  # noqa: F821
        back_populates="background_checks", foreign_keys=[employee_id]
    )
    created_by_employee: Mapped["Employee"] = relationship(  # noqa: F821
        back_populates="requested_checks", foreign_keys=[created_by]
    )
