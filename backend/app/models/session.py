from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Session(Base):
    """로그인 세션.

    주의: role, status를 여기에 복사해두지 않는다.
    로그인 시점의 스냅샷이 되어 퇴사·권한 변경이 반영되지 않기 때문이다.
    """

    __tablename__ = "sessions"
    __table_args__ = (
        # 퇴사 처리 시 employee_id로 세션을 일괄 삭제하기 위한 인덱스.
        Index("idx_sessions_employee", "employee_id"),
    )

    # secrets.token_urlsafe(32)로 생성한 세션 ID. 쿠키에 담긴다.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)

    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    employee: Mapped["Employee"] = relationship(back_populates="sessions")  # noqa: F821
