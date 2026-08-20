"""직원 정보 관련 비즈니스 로직.

라우터는 HTTP 입출력과 권한 선언만 담당하고 실제 처리는 여기서 한다.
테스트에서 이 함수들을 직접 호출할 수 있어야 하므로 요청 객체에 의존하지 않는다.
"""

from fastapi import HTTPException
from fastapi import status as http_status
from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password_async
from app.models import Employee, EmployeeStatus, Role
from app.models import Session as SessionModel
from app.schemas.employee import EmployeeAdminUpdate, EmployeeCreate, MeUpdate

# 유니크 제약 이름 → 사용자에게 보여줄 메시지.
# employee_no는 UNIQUE 제약, login_id는 유니크 인덱스라 이름 형식이 다르다.
_UNIQUE_VIOLATION_MESSAGES = {
    "employees_employee_no_key": "이미 사용 중인 사번입니다",
    "idx_employees_login_id": "이미 사용 중인 아이디입니다",
}


async def update_me(
    db: AsyncSession, employee: Employee, payload: MeUpdate
) -> Employee:
    """본인이 수정 가능한 필드만 반영한다.

    요청 바디를 순회하며 setattr하지 않는다. 필드를 하나씩 명시적으로 대입하므로
    스키마에 없는 필드는 물론이고 스키마가 나중에 확장되더라도
    여기에 적히지 않은 필드는 반영되지 않는다.

    exclude_unset을 쓰는 이유: 요청에 담기지 않은 필드는 건드리지 않고,
    명시적으로 null을 보낸 경우에만 값을 비운다.
    """
    data = payload.model_dump(exclude_unset=True)

    if "phone" in data:
        employee.phone = data["phone"]
    if "address" in data:
        employee.address = data["address"]

    await db.commit()
    await db.refresh(employee)
    return employee


async def list_employees(
    db: AsyncSession,
    status: EmployeeStatus | None = None,
    q: str | None = None,
) -> list[Employee]:
    """직원 목록.

    퇴사자를 기본으로 제외하지 않는다. 관리자는 퇴사자도 조회할 수 있어야 한다.
    필터는 선택 사항으로만 제공한다.

    페이지네이션은 두지 않는다. 200명 규모에서는 전체를 한 번에 보내는 편이
    단순하고, 커서·오프셋 관리 비용이 이득을 넘어선다. 규모가 커지면 그때 넣는다.
    """
    stmt = select(Employee)

    if status is not None:
        stmt = stmt.where(Employee.status == status)

    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(Employee.name.ilike(pattern), Employee.employee_no.ilike(pattern))
        )

    # 매 요청 순서가 달라지면 화면이 흔들리므로 정렬을 고정한다.
    stmt = stmt.order_by(Employee.employee_no)

    return list((await db.scalars(stmt)).all())


async def get_employee(db: AsyncSession, employee_id: int) -> Employee:
    """조회 대상 직원. 없으면 404.

    조회 대상의 재직 상태는 검사하지 않는다. 관리자는 퇴사자도 볼 수 있어야 한다.
    요청자의 상태 검사는 get_current_employee가 이미 수행한다.
    """
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, "직원을 찾을 수 없습니다")
    return employee


async def create_employee(db: AsyncSession, payload: EmployeeCreate) -> Employee:
    """직원 계정 생성. 초기 비밀번호는 login_id와 동일하다."""
    # 사전 조회로 흔한 경우를 걸러 어느 필드가 중복인지 정확히 알려준다.
    existing = await db.scalar(
        select(Employee).where(
            or_(
                Employee.employee_no == payload.employee_no,
                Employee.login_id == payload.login_id,
            )
        )
    )
    if existing is not None:
        if existing.employee_no == payload.employee_no:
            raise HTTPException(
                http_status.HTTP_409_CONFLICT, "이미 사용 중인 사번입니다"
            )
        raise HTTPException(
            http_status.HTTP_409_CONFLICT, "이미 사용 중인 아이디입니다"
        )

    employee = Employee(
        employee_no=payload.employee_no,
        login_id=payload.login_id,
        name=payload.name,
        date_of_birth=payload.date_of_birth,
        phone=payload.phone,
        address=payload.address,
        department=payload.department,
        position=payload.position,
        role=payload.role,
        # 생성 시점의 상태는 항상 ACTIVE다. 요청으로 지정할 수 없다.
        status=EmployeeStatus.ACTIVE,
        password_hash=await hash_password_async(payload.login_id),
    )
    db.add(employee)

    try:
        await db.commit()
    except IntegrityError as exc:
        # 사전 조회와 INSERT 사이에는 경쟁 조건이 있다. DB 제약이 최종 방어선이므로
        # 여기서 잡아 409로 변환한다. 사전 조회만으로 끝내면 동시 요청에서 500이 난다.
        await db.rollback()
        raise HTTPException(
            http_status.HTTP_409_CONFLICT, _unique_violation_message(exc)
        ) from exc

    await db.refresh(employee)
    return employee


def _unique_violation_message(exc: IntegrityError) -> str:
    detail = str(exc.orig)
    for constraint, message in _UNIQUE_VIOLATION_MESSAGES.items():
        if constraint in detail:
            return message
    return "이미 사용 중인 값입니다"


async def update_employee(
    db: AsyncSession, target: Employee, payload: EmployeeAdminUpdate
) -> Employee:
    """관리자의 직원 정보 수정.

    update_me와 같은 원칙이다. setattr 루프를 쓰지 않고 필드를 명시적으로 대입한다.
    """
    data = payload.model_dump(exclude_unset=True)

    if "name" in data:
        target.name = data["name"]
    if "date_of_birth" in data:
        target.date_of_birth = data["date_of_birth"]
    if "phone" in data:
        target.phone = data["phone"]
    if "address" in data:
        target.address = data["address"]
    if "department" in data:
        target.department = data["department"]
    if "position" in data:
        target.position = data["position"]
    if "role" in data and data["role"] is not None:
        target.role = data["role"]

    await db.commit()
    await db.refresh(target)
    return target


async def resign_employee(db: AsyncSession, target: Employee) -> Employee:
    """퇴사 처리.

    상태 변경과 세션 삭제를 하나의 트랜잭션으로 커밋한다.
    세션 저장소가 DB이므로 묶을 수 있고, 묶으면 "상태는 바뀌었는데 세션은 남아있는"
    어긋난 상태가 원천적으로 발생하지 않는다.

    복직은 구현하지 않는다(요구사항에 없음). status가 상태 필드이므로
    필요해지면 되돌릴 수 있다.
    """
    target.status = EmployeeStatus.RESIGNED
    await db.execute(delete(SessionModel).where(SessionModel.employee_id == target.id))
    await db.commit()
    await db.refresh(target)
    return target


def ensure_not_self_demotion(
    target: Employee, admin: Employee, new_role: Role | None
) -> None:
    """관리자가 자신의 권한을 강등하는 것을 막는다.

    시스템에 관리자가 하나도 남지 않는 상황을 방지한다.
    """
    if target.id == admin.id and new_role is not None and new_role != Role.ADMIN:
        raise HTTPException(
            http_status.HTTP_400_BAD_REQUEST, "본인의 권한은 변경할 수 없습니다"
        )


def ensure_not_self_resign(target: Employee, admin: Employee) -> None:
    if target.id == admin.id:
        raise HTTPException(
            http_status.HTTP_400_BAD_REQUEST, "본인 계정은 퇴사 처리할 수 없습니다"
        )


def ensure_not_already_resigned(target: Employee) -> None:
    if target.status == EmployeeStatus.RESIGNED:
        raise HTTPException(
            http_status.HTTP_409_CONFLICT, "이미 퇴사 처리된 계정입니다"
        )
