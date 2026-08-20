"""직원 정보 관련 비즈니스 로직."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Employee
from app.schemas.employee import MeUpdate


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
