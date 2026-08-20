"""개발용 시드 데이터.

    uv run python -m app.seed

초기 비밀번호는 로그인 아이디와 동일하다(docs/05-data-model.md).
login_id 존재 여부를 확인하므로 여러 번 실행해도 중복 생성되지 않는다.
"""

import asyncio
from datetime import date

from sqlalchemy import select

from app.core.security import hash_password
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
                    # 초기 비밀번호는 로그인 아이디와 동일하다.
                    password_hash=hash_password(row["login_id"]),
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
