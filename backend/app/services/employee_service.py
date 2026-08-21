"""직원 정보 관련 비즈니스 로직.

라우터는 HTTP 입출력과 권한 선언만 담당하고 실제 처리는 여기서 한다.
테스트에서 이 함수들을 직접 호출할 수 있어야 하므로 요청 객체에 의존하지 않는다.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from fastapi import status as http_status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    INITIAL_PASSWORD,
    hash_password_async,
    verify_password_async,
)
from app.models import Employee, EmployeeStatus, Role
from app.schemas.employee import EmployeeAdminUpdate, EmployeeCreate, MeUpdate
from app.services import auth_service

# 유니크 제약 이름 → 사용자에게 보여줄 메시지.
# employee_no는 UNIQUE 제약, login_id는 유니크 인덱스라 이름 형식이 다르다.
#
# 사번 위반은 사용자 잘못이 아니다. 서버가 발급하는 값이므로 입력 중복이 있을 수
# 없고, 두 관리자가 동시에 등록해 같은 번호를 읽은 경우에만 발생한다.
# "이미 사용 중인 사번입니다"라고 하면 사번을 입력한 적도 없는 관리자가 당황한다.
_UNIQUE_VIOLATION_MESSAGES = {
    "employees_employee_no_key": "사번 발급 중 충돌이 발생했습니다. 다시 시도해 주세요",
    "idx_employees_login_id": "이미 사용 중인 아이디입니다",
}

# 사번의 연도는 회사가 있는 지역의 날짜를 따른다.
# UTC로 두면 1월 1일 오전에 한국에서 등록한 직원이 아직 UTC로는 12월 31일이라
# 전년도 사번을 받는다. 서버의 로컬 시간(datetime.now())도 쓰지 않는다.
# 컨테이너의 TZ 설정에 따라 결과가 달라지면 같은 코드가 환경마다 다르게 동작한다.
_COMPANY_TZ = ZoneInfo("Asia/Seoul")

# 일련번호의 최소 자릿수. 999를 넘으면 자연스럽게 네 자리가 된다.
_SEQUENCE_MIN_DIGITS = 3


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


async def _next_employee_no(db: AsyncSession) -> str:
    """다음 사번을 발급한다.

    형식: EMP-{연도}-{3자리 일련번호}
    연도가 바뀌면 001부터 다시 시작한다. 사번만 보고 입사 연도를 알 수 있다.
    접두사가 연도마다 다르므로 지난 연도의 사번은 조회 대상에 들어오지 않는다.

    가장 큰 값을 `ORDER BY employee_no DESC LIMIT 1`로 뽑지 않는다.
    문자열 정렬이 숫자 정렬과 일치하는 것은 제로패딩 자릿수가 같을 때뿐이라,
    999를 넘어 네 자리가 되는 순간 "EMP-2026-1000" < "EMP-2026-999"가 되어
    코드가 조용히 틀린다. 올해분만 읽어 숫자로 비교하면 그 전제 자체가 필요 없고,
    1000번째 사번은 그대로 EMP-2026-1000이 된다.
    한 해 등록 건수는 많아야 수백 건이라 전부 읽어도 부담이 없다.
    """
    year = datetime.now(_COMPANY_TZ).year
    prefix = f"EMP-{year}-"

    rows = await db.scalars(
        select(Employee.employee_no).where(Employee.employee_no.like(f"{prefix}%"))
    )
    # 접두사가 같아도 뒤가 숫자가 아닌 값은 채번 대상이 아니다.
    # 과거에 수동으로 넣은 사번이 섞여 있어도 int() 변환에서 터지지 않는다.
    used = [int(suffix) for no in rows if (suffix := no[len(prefix) :]).isdigit()]

    return f"{prefix}{max(used, default=0) + 1:0{_SEQUENCE_MIN_DIGITS}d}"


async def create_employee(db: AsyncSession, payload: EmployeeCreate) -> Employee:
    """직원 계정 생성.

    사번은 서버가 발급하고 초기 비밀번호는 INITIAL_PASSWORD 고정값이다.
    관리자가 입력하는 식별자는 login_id뿐이다.
    """
    # 사전 조회로 흔한 경우를 걸러 명확한 메시지를 준다.
    # employee_no는 검사하지 않는다. 사용자 입력이 아니라 서버 발급이므로
    # 입력 중복이 있을 수 없고, 채번 경쟁 조건은 아래 IntegrityError가 잡는다.
    existing = await db.scalar(
        select(Employee).where(Employee.login_id == payload.login_id)
    )
    if existing is not None:
        raise HTTPException(
            http_status.HTTP_409_CONFLICT, "이미 사용 중인 아이디입니다"
        )

    # 해싱을 채번보다 먼저 한다. bcrypt는 호출당 약 180ms가 걸리는데, 채번을 먼저
    # 하면 번호를 읽은 시점부터 커밋까지 그 시간만큼 창이 열려 동시 등록이 같은
    # 번호를 집어갈 확률이 크게 올라간다. 순서만 바꿔도 창이 거의 사라진다.
    # 재시도를 넣는 것과 달리 흐름이 복잡해지지 않는다.
    password_hash = await hash_password_async(INITIAL_PASSWORD)

    employee = Employee(
        employee_no=await _next_employee_no(db),
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
        password_hash=password_hash,
    )
    db.add(employee)

    try:
        await db.commit()
    except IntegrityError as exc:
        # 두 가지 경쟁 조건을 여기서 함께 잡는다.
        # login_id는 사전 조회와 INSERT 사이에 다른 요청이 끼어든 경우,
        # employee_no는 두 요청이 같은 번호를 읽어간 경우다.
        # 재시도는 두지 않는다. 관리자 수가 적고 등록 빈도가 낮아 발생 확률이
        # 극히 낮으며, 발생해도 다시 등록하면 해결된다.
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
    await auth_service.delete_all_sessions(db, target.id)
    await db.commit()
    await db.refresh(target)
    return target


async def change_password(
    db: AsyncSession, employee: Employee, current: str, new: str
) -> None:
    """직원 본인의 비밀번호 변경.

    현재 비밀번호를 요구한다. 세션만으로 변경을 허용하면 자리를 비운 사이
    타인이 비밀번호를 바꿔 계정을 가져갈 수 있다. 세션 보유는 "지금 이 브라우저를
    쓰고 있다"는 증거일 뿐 본인 확인이 아니다.

    검증 순서를 바꾸지 않는다. 현재 비밀번호를 먼저 확인해야,
    비밀번호를 모르는 사람이 "새 값이 현재 값과 같은지" 응답으로 알아낼 수 없다.
    """
    if not await verify_password_async(current, employee.password_hash):
        raise HTTPException(
            http_status.HTTP_400_BAD_REQUEST, "현재 비밀번호가 올바르지 않습니다"
        )

    if current == new:
        raise HTTPException(
            http_status.HTTP_400_BAD_REQUEST,
            "새 비밀번호가 현재 비밀번호와 같습니다",
        )

    employee.password_hash = await hash_password_async(new)
    # 본인 세션까지 모두 지운다. 비밀번호 변경은 대개 "유출된 것 같다"는 상황에서
    # 일어나므로, 다른 기기의 세션이 살아 있으면 변경한 의미가 없다.
    await auth_service.delete_all_sessions(db, employee.id)
    await db.commit()


async def reset_password(db: AsyncSession, target: Employee) -> None:
    """관리자의 비밀번호 초기화.

    퇴사자에게도 허용한다. 로그인 자체가 막혀 있어 무해하고,
    복직 시나리오를 굳이 배제할 이유가 없다.
    관리자가 자기 자신을 초기화하는 것도 막지 않는다. 막을 근거가 없다.

    세션을 지우지 않으면 초기화된 직원이 기존 세션으로 계속 접근할 수 있어
    초기화의 의미가 반감된다.
    """
    target.password_hash = await hash_password_async(INITIAL_PASSWORD)
    await auth_service.delete_all_sessions(db, target.id)
    await db.commit()


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
