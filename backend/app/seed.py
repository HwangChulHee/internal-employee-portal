"""개발용 시드 데이터.

    uv run python -m app.seed

초기 비밀번호는 INITIAL_PASSWORD 고정값이다(docs/05-data-model.md).
login_id 존재 여부를 확인하므로 여러 번 실행해도 중복 생성되지 않는다.

멱등성의 대가로, 이미 있는 계정의 비밀번호는 갱신하지 않는다.
초기 비밀번호 정책을 바꾼 뒤 시드 계정에 반영하려면 DB를 비워야 한다.

    docker compose down -v && docker compose up -d
"""

import asyncio
from datetime import date

from sqlalchemy import select

from app.core.security import INITIAL_PASSWORD, hash_password
from app.database import AsyncSessionLocal
from app.models import Employee, EmployeeStatus, Role

SEED_EMPLOYEES: list[dict] = [
    {
        "employee_no": "EMP-2024-001",
        "login_id": "admin",
        "name": "김관리",
        "date_of_birth": date(1985, 3, 12),
        "phone": "010-1000-0001",
        "address": "서울특별시 중구 세종대로 110",
        "department": "경영지원팀",
        "position": "부장",
        "role": Role.ADMIN,
        "status": EmployeeStatus.ACTIVE,
    },
    {
        "employee_no": "EMP-2024-002",
        "login_id": "emp001",
        "name": "김민준",
        "date_of_birth": date(1993, 7, 24),
        "phone": "010-1000-0002",
        "address": "서울특별시 마포구 월드컵북로 21",
        "department": "개발팀",
        "position": "선임",
        "role": Role.EMPLOYEE,
        "status": EmployeeStatus.ACTIVE,
    },
    {
        "employee_no": "EMP-2024-003",
        "login_id": "emp002",
        "name": "이서연",
        "date_of_birth": date(1995, 11, 3),
        "phone": "010-1000-0003",
        "address": "경기도 성남시 분당구 판교역로 235",
        "department": "개발팀",
        "position": "주임",
        "role": Role.EMPLOYEE,
        "status": EmployeeStatus.ACTIVE,
    },
    {
        # 복성. 외부 API 전송 시 성/이름 분리가 올바른지 확인하는 데 쓴다.
        "employee_no": "EMP-2024-004",
        "login_id": "emp003",
        "name": "남궁민",
        "date_of_birth": date(1990, 1, 30),
        "phone": "010-1000-0004",
        "address": "부산광역시 해운대구 센텀중앙로 79",
        "department": "인사팀",
        "position": "대리",
        "role": Role.EMPLOYEE,
        "status": EmployeeStatus.ACTIVE,
    },
    {
        "employee_no": "EMP-2024-005",
        "login_id": "emp004",
        "name": "정하윤",
        "date_of_birth": date(1996, 4, 8),
        "phone": "010-1000-0005",
        "address": "대전광역시 유성구 대학로 99",
        "department": "재무팀",
        "position": "대리",
        "role": Role.EMPLOYEE,
        "status": EmployeeStatus.ACTIVE,
    },
    {
        "employee_no": "EMP-2024-006",
        "login_id": "emp005",
        "name": "최지우",
        "date_of_birth": date(1992, 9, 15),
        "phone": "010-1000-0006",
        "address": "서울특별시 강남구 테헤란로 152",
        "department": "개발팀",
        "position": "책임",
        "role": Role.EMPLOYEE,
        "status": EmployeeStatus.ACTIVE,
    },
    {
        "employee_no": "EMP-2024-007",
        "login_id": "emp006",
        "name": "박서준",
        "date_of_birth": date(1998, 12, 2),
        "phone": "010-1000-0007",
        "address": "광주광역시 서구 상무중앙로 61",
        "department": "영업팀",
        "position": "사원",
        "role": Role.EMPLOYEE,
        "status": EmployeeStatus.ACTIVE,
    },
    {
        # 복성 후보가 아닌 황씨. 남궁민(emp003)과 달리 확정 다이얼로그 없이 나가야 한다.
        "employee_no": "EMP-2024-008",
        "login_id": "emp007",
        "name": "황민서",
        "date_of_birth": date(1994, 6, 27),
        "phone": "010-1000-0008",
        "address": "대구광역시 수성구 동대구로 111",
        "department": "인사팀",
        "position": "주임",
        "role": Role.EMPLOYEE,
        "status": EmployeeStatus.ACTIVE,
    },
    {
        # 두 번째 퇴사자. 퇴사 필터와 페이징이 함께 동작하는지 확인하는 데 쓴다.
        "employee_no": "EMP-2024-010",
        "login_id": "emp008",
        "name": "한지민",
        "date_of_birth": date(1991, 2, 19),
        "phone": "010-1000-0010",
        "address": "울산광역시 남구 삼산로 273",
        "department": "재무팀",
        "position": "과장",
        "role": Role.EMPLOYEE,
        "status": EmployeeStatus.RESIGNED,
    },
    {
        # 퇴사자. 로그인 차단과 기존 세션 무효화를 확인하는 데 쓴다.
        "employee_no": "EMP-2024-009",
        "login_id": "emp009",
        "name": "박퇴사",
        "date_of_birth": date(1988, 5, 17),
        "phone": "010-1000-0009",
        "address": "인천광역시 연수구 컨벤시아대로 165",
        "department": "영업팀",
        "position": "과장",
        "role": Role.EMPLOYEE,
        "status": EmployeeStatus.RESIGNED,
    },
]


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        existing = set((await db.scalars(select(Employee.login_id))).all())

        created = 0
        for row in SEED_EMPLOYEES:
            if row["login_id"] in existing:
                print(f"skip   {row['login_id']} (이미 존재)")
                continue

            db.add(
                Employee(
                    **row,
                    password_hash=hash_password(INITIAL_PASSWORD),
                )
            )
            created += 1
            print(
                f"create {row['login_id']} ({row['name']}, "
                f"{row['role'].value}, {row['status'].value})"
            )

        await db.commit()
        print(f"\n완료: {created}건 생성, {len(SEED_EMPLOYEES) - created}건 건너뜀")


if __name__ == "__main__":
    asyncio.run(seed())
