from datetime import date, datetime
from enum import Enum

from sqlalchemy import CheckConstraint, Date, DateTime, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Role(str, Enum):
    EMPLOYEE = "EMPLOYEE"
    ADMIN = "ADMIN"


class EmployeeStatus(str, Enum):
    ACTIVE = "ACTIVE"
    RESIGNED = "RESIGNED"


def _sql_values(enum_cls: type[Enum]) -> str:
    """CHECK 제약에 넣을 값 목록. Python 상수와 DB 제약이 어긋나지 않도록 여기서 생성한다."""
    return ", ".join(f"'{member.value}'" for member in enum_cls)


class Employee(Base):
    """직원과 계정을 한 테이블로 관리한다. 관리자도 직원이며 role만 다르다."""

    __tablename__ = "employees"
    __table_args__ = (
        # ENUM 타입 대신 문자열 + CHECK. 값 추가 시 마이그레이션 부담을 피한다.
        CheckConstraint(f"role IN ({_sql_values(Role)})", name="ck_employees_role"),
        CheckConstraint(
            f"status IN ({_sql_values(EmployeeStatus)})", name="ck_employees_status"
        ),
        # 로그인 시 조회. UNIQUE 제약이 곧 인덱스이므로 유니크 인덱스 하나로 둘 다 만족시킨다.
        Index("idx_employees_login_id", "login_id", unique=True),
    )

    # 내부 PK. 사번 체계가 바뀌어도 FK가 흔들리지 않도록 업무 식별자와 분리한다.
    id: Mapped[int] = mapped_column(primary_key=True)

    # 업무용 사번. 외부 Background Check API의 employeeId로 전달된다.
    employee_no: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)

    # 로그인 아이디. 초기 비밀번호는 이 값과 동일하게 발급한다.
    login_id: Mapped[str] = mapped_column(String(50), nullable=False)

    # bcrypt 해시. 평문 저장 금지.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    # 한글 통성명. 성/이름을 분리 저장하지 않는다.
    name: Mapped[str] = mapped_column(String(50), nullable=False)

    # 외부 API 필수 파라미터이자 동명이인을 구분하는 실질적 식별 키.
    date_of_birth: Mapped[date] = mapped_column(Date, nullable=False)

    # 직원 본인이 수정 가능한 필드
    phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(String(200))

    # 관리자만 수정 가능한 필드
    department: Mapped[str | None] = mapped_column(String(50))
    position: Mapped[str | None] = mapped_column(String(50))

    # 권한. 직원 본인은 수정할 수 없다(요청 스키마에서 제외).
    role: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=Role.EMPLOYEE.value
    )

    # 재직 상태. 퇴사 시 물리 삭제하지 않고 RESIGNED로 변경한다.
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=EmployeeStatus.ACTIVE.value
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # PostgreSQL은 자동 갱신하지 않으므로 onupdate로 갱신한다.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    sessions: Mapped[list["Session"]] = relationship(  # noqa: F821
        back_populates="employee",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    # background_checks가 employees를 두 번 참조하므로 foreign_keys를 명시한다.
    background_checks: Mapped[list["BackgroundCheck"]] = relationship(  # noqa: F821
        back_populates="employee",
        foreign_keys="BackgroundCheck.employee_id",
    )
    requested_checks: Mapped[list["BackgroundCheck"]] = relationship(  # noqa: F821
        back_populates="created_by_employee",
        foreign_keys="BackgroundCheck.created_by",
    )

    @property
    def is_active(self) -> bool:
        return self.status == EmployeeStatus.ACTIVE

    @property
    def is_admin(self) -> bool:
        return self.role == Role.ADMIN
