# 인증과 인가

## 인증과 인가는 다른 문제다

| 구분 | 질문 | 수단 |
|---|---|---|
| 인증 (Authentication) | 너는 누구인가 | 로그인, 세션 |
| 인가 (Authorization) | 이것을 해도 되는가 | 역할, 소유권, 필드 |

FastAPI의 `Depends` 체인으로 두 단계를 분리한다.

---

## 왜 JWT가 아니라 세션인가

### 문제: "즉시 차단"과 무상태 토큰의 충돌

JWT는 자기완결적(self-contained)이다.

```
토큰 = { userId, role, exp } + 서명
```

서버는 서명만 검증하고 통과시킨다. DB를 조회하지 않는다.
이것이 JWT의 장점이자 — 이 요구사항에서는 그대로 단점이 된다.

**서버가 발급된 토큰을 취소할 방법이 없다.** 관리자가 퇴사 처리해도 해당 직원의 토큰은 만료까지 유효하다.

```
09:00  직원 로그인 → 토큰 발급 (24시간 유효)
14:00  관리자가 퇴사 처리
14:01  직원이 여전히 접근 가능        ← 요구사항 위반
```

### 검토한 선택지

| 방식 | 즉시성 | 비용 |
|---|---|---|
| A. 서버 세션 | 완벽 | 세션 저장소 필요 |
| B. JWT + 매 요청 DB 조회 | 완벽 | 무상태 장점 상실 |
| C. 토큰 블랙리스트 | 완벽 | 결국 상태 저장소가 필요해 A의 열화판 |
| D. 짧은 만료 + 리프레시 토큰 | 최대 만료 시간만큼 지연 | 구현 복잡 |

C는 폐기 목록을 어딘가 저장해야 하므로 세션과 같아지며, 만료된 토큰의 정리까지 관리해야 해 A보다 복잡하다.
D는 대규모 서비스의 표준 패턴이지만 "즉시"라는 요구사항을 만족하지 못한다.

### 결정: A (서버 세션)

근거:

- 200명 규모 사내 시스템으로 서버가 여러 대일 필요가 없다
- "즉시 차단"이 명시적 요구사항이므로 취소 가능한 방식이어야 한다
- JWT를 쓰면서 매 요청 DB를 조회하는 것은 결국 세션을 흉내 내는 것이다

**Redis는 사용하지 않는다.** 서버 1대 구성에서 세션 공유가 필요 없으며,
현재 규모에서 도입은 오버엔지니어링이다.
저장소 교체를 위한 추상화 계층도 두지 않는다 — 교체 시나리오가 실재하지 않는 상태에서의 추상화는 비용만 늘린다.

### 실무 관점의 보충

대규모 서비스는 대부분 짧은 액세스 토큰 + Redis 리프레시 토큰 조합을 쓰며,
**취소가 최대 몇 분 지연되는 것을 감수한다.** 초당 수만 요청이 매번 상태 저장소를 조회하면
그것이 병목이자 단일 장애점이 되기 때문이다.

즉 이 과제의 "즉시 차단" 요구사항은 실무 표준보다 오히려 엄격하다.
현재 규모에서는 매 요청 조회 비용이 무시할 수준이므로 요구사항을 그대로 만족시키는 쪽을 택했다.

---

## 세션 설계의 핵심 원칙

> **세션은 "누구인지"만 알려주는 신분증이다.
> "무엇을 할 수 있는지"는 매 요청 DB에서 최신 값을 확인한다.**

세션에 `role`이나 `status`를 저장하면 **로그인 시점의 스냅샷**이 된다.
이후 퇴사하거나 권한이 변경되어도 반영되지 않는다.

```sql
-- sessions 테이블에는 employee_id만 저장한다
id          VARCHAR(64) PRIMARY KEY
employee_id INTEGER     NOT NULL REFERENCES employees(id)
created_at  TIMESTAMPTZ
expires_at  TIMESTAMPTZ
```

---

## 인증 흐름

```
쿠키의 SESSIONID
  → sessions JOIN employees 로 한 번에 조회
  → expires_at 확인
  → employees.status 확인 (ACTIVE가 아니면 401 + 세션 삭제)
  → req.user에 최신 employee 주입
```

조인 한 번으로 세션과 직원 정보를 함께 가져오므로 DB 왕복은 1회다.

```python
async def get_current_employee(
    session_id: Annotated[str | None, Cookie(alias="SESSIONID")] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = ...,
) -> Employee:
    if not session_id:
        raise HTTPException(401, "로그인이 필요합니다")

    stmt = (
        select(SessionModel, Employee)
        .join(Employee, Employee.id == SessionModel.employee_id)
        .where(SessionModel.id == session_id)
    )
    row = (await db.execute(stmt)).first()
    if not row:
        raise HTTPException(401, "세션이 만료되었습니다")

    session, employee = row
    if session.expires_at < datetime.now(timezone.utc):
        raise HTTPException(401, "세션이 만료되었습니다")
    if employee.status != "ACTIVE":
        await db.execute(delete(SessionModel).where(SessionModel.employee_id == employee.id))
        await db.commit()
        raise HTTPException(401, "퇴사 처리된 계정입니다")

    return employee
```

---

## 차단 지점

퇴사자를 막아야 하는 지점은 세 곳이며, 성격이 다르다.

| 지점 | 역할 | 필요성 |
|---|---|---|
| 로그인 시 `status` 검사 | 퇴사자의 신규 로그인 차단 | **필수** |
| 퇴사 처리 시 세션 삭제 | 그 순간 즉시 끊음 | 권장 |
| 매 요청 DB 확인 | 안전망 | 권장 |

**로그인 시 검사가 없으면 퇴사자가 재로그인해 새 세션을 발급받는다.**
이 경로는 퇴사 처리 트랜잭션으로 막을 수 없으므로 별도 검사가 반드시 필요하다.

세션 저장소가 DB이므로 상태 변경과 세션 삭제를 하나의 트랜잭션으로 묶을 수 있다.

```sql
BEGIN;
  UPDATE employees SET status = 'RESIGNED' WHERE id = ?;
  DELETE FROM sessions WHERE employee_id = ?;
COMMIT;
```

이 구성에서는 두 저장소가 어긋나는 상황이 발생하지 않는다.
(세션 저장소가 Redis 등 이종 저장소라면 트랜잭션에 묶을 수 없어 정합성 문제가 생긴다.
DB를 세션 저장소로 선택한 부수적 이점이다.)

매 요청 확인은 이 구성에서 "없으면 뚫리는" 장치가 아니라 방어적 장치다.
다만 어차피 `req.user`를 채우기 위해 employees를 조회해야 하므로 추가 비용이 사실상 0이다.

### 세션을 통째로 지우는 지점은 세 곳이다

| 지점 | 이유 |
|---|---|
| 퇴사 처리 | 그 순간부터 접근을 끊어야 한다 |
| 본인 비밀번호 변경 | 대개 "유출된 것 같다"는 상황이다. 다른 기기의 세션이 살아 있으면 변경의 의미가 없다 |
| 관리자 비밀번호 초기화 | 기존 세션이 남으면 그 직원이 계속 접근할 수 있어 초기화가 반쯤 무의미해진다 |

셋 다 같은 문장(`DELETE FROM sessions WHERE employee_id = ?`)이고 모두
employees 변경과 한 트랜잭션에 묶여야 하므로,
`auth_service.delete_all_sessions()` 하나로 두고 커밋은 호출자가 한다.

비밀번호를 바꾼 본인도 함께 로그아웃된다.
불편해 보이지만, 새 비밀번호로 다시 로그인하는 것이 자연스러운 흐름이고
"내 다른 세션만 살려두는" 예외를 만들면 위 이유가 통째로 무너진다.

### 퇴사자가 보는 메시지는 경로에 따라 다르다

응답 코드 표는 퇴사자에게 "퇴사 처리된 계정입니다"가 나가는 것으로 되어 있으나,
실제로는 두 갈래다.

| 경로 | 메시지 |
|---|---|
| 퇴사 처리 직후 첫 요청 | 세션이 만료되었습니다 |
| 퇴사자가 재로그인 시도 | 퇴사 처리된 계정입니다 |

퇴사 처리가 세션을 **이미 삭제했으므로**, 다음 요청은 "퇴사자 발견" 분기가 아니라
"세션 없음" 분기에 걸린다. 둘 다 401이고 프론트 처리도 동일하다.

정확한 메시지를 주려면 세션을 남겨두거나 별도 표식이 필요한데,
그것은 "퇴사 시 세션 삭제"라는 설계와 정면으로 어긋난다.
사용자는 재로그인 시점에 이유를 알게 되므로 실질적인 문제가 없다.

---

## 퇴사 처리는 삭제가 아니다

`status: ACTIVE → RESIGNED` 상태 변경으로 처리한다. 물리 삭제하지 않는다.

**근거**

- 관리자는 퇴사자 정보도 조회할 수 있어야 한다 (요구사항)
- Background Check 이력이 참조 무결성을 잃는다
- **근로기준법 제42조**: 근로자 명부 등 3년 보존 의무
- **개인정보보호법 제21조**: "다른 법령에 따라 보존해야 하는 경우"는 파기 의무의 예외

실무의 처리 순서는 다음과 같다.

```
퇴사 → 상태 변경 (접근 차단)
     → 법정 보존기간 동안 보관
     → 기간 경과 후 파기
```

**접근 차단과 데이터 파기는 서로 다른 시점의 서로 다른 행위다.**

---

## 인가: 세 층위

### 1. 역할 기반

```python
async def require_admin(emp: Annotated[Employee, Depends(get_current_employee)]) -> Employee:
    if emp.role != "ADMIN":
        raise HTTPException(403, "권한이 없습니다")
    return emp
```

### 2. 소유권 기반

`GET /api/employees/{employee_id}`에 "로그인했는가"만 검사하면 직원이 타인의 id로 조회할 수 있다.
**본인이거나 관리자**여야 한다.

```python
async def require_self_or_admin(employee_id: int, emp: ...) -> Employee:
    if emp.id != employee_id and emp.role != "ADMIN":
        raise HTTPException(403, "권한이 없습니다")
    return emp
```

### 3. 필드 수준 (가장 놓치기 쉬움)

직원이 자신의 정보를 수정할 때 다음 요청을 보낼 수 있다.

```json
{ "phone": "010-1111-2222", "role": "ADMIN" }
```

수정 로직이 요청 바디를 그대로 반영하면 **직원이 스스로 관리자가 된다.**
화면에 해당 입력란이 없어도 API는 요청을 받는다.

**해결: Pydantic 스키마로 화이트리스트**

```python
class MeUpdate(BaseModel):
    phone: str | None = None
    address: str | None = None
    # role, status, name, employee_no, date_of_birth 없음
```

정의되지 않은 필드는 무시된다. 직원용과 관리자용 스키마를 분리하는 것이 핵심이다.

| 필드 | 직원 본인 | 관리자 |
|---|---|---|
| `phone`, `address` | 수정 가능 | 수정 가능 |
| `name`, `date_of_birth`, `employee_no` | 조회만 | 수정 가능 |
| `department`, `position` | 조회만 | 수정 가능 |
| `role`, `status` | 접근 불가 | 수정 가능 |

### 응답 필드 통제

수정뿐 아니라 노출도 용도별로 나눈다.
목록 API가 생년월일까지 전부 실어 보낼 이유가 없다.

```python
class EmployeeListItem(BaseModel):   # 목록: 최소한
    id: int
    name: str
    department: str | None
    status: str

class EmployeeDetail(BaseModel):     # 상세: 전체
    ...
```

FastAPI의 `response_model`이 자동으로 필터링한다.

---

## 라우팅과 권한 매핑

```python
POST   /api/auth/login                                   공개
POST   /api/auth/logout                                  인증
GET    /api/auth/password-policy                         인증
GET    /api/me                                           인증
PATCH  /api/me                                           인증 (제한된 필드만)
PATCH  /api/me/password                                  인증 (본인)
GET    /api/employees                                    관리자
POST   /api/employees                                    관리자
GET    /api/employees/{employee_id}                      본인 또는 관리자
PATCH  /api/employees/{employee_id}                      관리자
POST   /api/employees/{employee_id}/resign               관리자
POST   /api/employees/{employee_id}/password/reset       관리자
POST   /api/employees/{employee_id}/background-checks    관리자
GET    /api/employees/{employee_id}/background-checks    관리자
GET    /api/background-checks/{background_check_id}      관리자
```

라우터 시그니처의 `Depends`만 보아도 접근 권한이 드러나는 것이 이 방식의 장점이다.

`GET /api/auth/password-policy`는 초기 비밀번호와 최소 길이를 화면에 알려준다.
프론트에 같은 값을 적어두면 백엔드가 정책을 바꿨을 때 화면만 옛 값을 안내한다.
공개하지 않고 인증을 요구하는 이유는, 초기 비밀번호를 누구나 볼 수 있으면
신규 계정의 첫 비밀번호를 그대로 알려주는 셈이기 때문이다.

**경로 파라미터 이름은 `{id}`가 아니라 `{employee_id}`로 쓴다.**
`require_self_or_admin`이 경로 파라미터를 이름으로 주입받기 때문이다.
`{id}`로 선언하면 FastAPI가 `employee_id`를 쿼리 파라미터로 요구해 422가 발생한다.

신원조회 상세의 `{background_check_id}`는 **우리 DB의 내부 PK**다.
외부 API가 발급한 `checkId`는 URL에 노출하지 않고 응답 본문에만 담는다.
이름을 `{check_id}`로 두면 둘 중 무엇인지 읽는 사람이 오해한다.

---

## 부수 규칙

**관리자의 자기 자신 퇴사 처리 방지**

```python
if target_id == current_admin.id:
    raise HTTPException(400, "본인 계정은 퇴사 처리할 수 없습니다")
```

시스템에 관리자가 사라지는 상황을 막는다.

**Background Check는 관리자 전용**

범죄이력과 신용등급이 포함된 가장 민감한 데이터다.
요구사항이 "관리자가 볼 수 있도록"이라고 명시했으므로 직원 본인도 접근할 수 없게 한다.

**401과 403의 구분**

| 코드 | 의미 | 프론트 처리 |
|---|---|---|
| 401 | 신원을 확인할 수 없음 (미로그인, 세션 만료, 퇴사) | 로그인 화면으로 |
| 403 | 신원은 확인되나 권한 없음 | 권한 없음 안내 |

---

## 쿠키 설정

```python
response.set_cookie(
    "SESSIONID", session_id,
    httponly=True,                    # JS 접근 차단 (XSS 방어)
    secure=settings.COOKIE_SECURE,    # 로컬 False, 배포 True
    samesite="lax",                   # CSRF 방어
    max_age=settings.SESSION_MAX_AGE_SECONDS,
)
```

`HttpOnly`가 중요하다. XSS가 발생해도 세션 탈취가 어렵다.
로컬 스토리지에 토큰을 저장하는 방식은 JS로 읽히므로 이 방어가 불가능하다.

`COOKIE_SECURE`를 환경변수로 분리한 이유:
로컬은 HTTP이므로 `secure=True`를 켜면 쿠키가 아예 전송되지 않는다.

---

## 검증 체크리스트

구현 후 **화면이 아니라 API를 직접 호출**하여 확인한다.

| 시도 | 기대 |
|---|---|
| 미인증 상태로 `GET /api/employees` | 401 |
| 직원 세션으로 `GET /api/employees` | 403 |
| 직원이 타인 id로 `GET /api/employees/{다른id}` | 403 |
| 직원이 `PATCH /api/me`에 `role: ADMIN` 포함 | 무시됨 |
| 직원이 Background Check 요청 | 403 |
| 퇴사자 세션으로 임의 API | 401 |
| 퇴사자 로그인 시도 | 401 |

특히 네 번째 항목은 화면 조작만으로는 검증되지 않으므로 반드시 직접 호출해 확인한다.
