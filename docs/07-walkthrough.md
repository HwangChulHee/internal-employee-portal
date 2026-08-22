# 직접 확인 가이드 (Walkthrough)

이 문서는 완성된 시스템을 **직접 클릭하고 관찰하며** 설계를 이해하기 위한 것이다.
화면에서 무엇을 누르면 어떤 API가 불리고, 백엔드에서 어떤 코드 경로를 지나,
DB에 어떤 변화가 생기는지를 단계별로 따라간다.

각 단계는 다음 틀을 따른다.

- **해보기** — 화면에서 할 동작
- **관찰하기** — 네트워크 탭·DB에서 확인할 것
- **흐름** — 클릭에서 DB까지의 경로 (파일명 포함)
- **설계 포인트** — 여기 걸린 설계 결정과 근거 문서 링크
- **스스로 확인** — 설명할 수 있어야 할 질문

평가자가 시스템을 검증하는 용도로도 쓸 수 있다.

---

## 0. 준비

### 실행

```bash
# 터미널 1 — DB
cd /home/hch/internal-employee-portal
docker compose up -d

# 터미널 2 — 백엔드
cd backend
uv run alembic upgrade head    # 스키마 생성
uv run python -m app.seed      # 시드 데이터
uv run uvicorn app.main:app --reload

# 터미널 3 — 프론트
cd frontend
npm run dev
```

브라우저: http://localhost:5173
API 문서: http://localhost:8000/docs

### 시드 계정

초기 비밀번호는 다섯 계정 모두 **`bit1234`**다.

| 아이디 | 이름 | 역할 | 상태 | 용도 |
|---|---|---|---|---|
| `admin` | 김관리 | 관리자 | 재직 | 관리자 기능 |
| `emp001` | 김민준 | 직원 | 재직 | 일반 직원 |
| `emp002` | 이서연 | 직원 | 재직 | 타인 정보 접근 실험 |
| `emp003` | 남궁민 | 직원 | 재직 | **복성 이름 매핑** |
| `emp009` | 박퇴사 | 직원 | **퇴사** | **접근 차단** |

### DB 접속

관찰용으로 자주 쓴다. 미리 열어두면 편하다.

```bash
docker compose exec db psql -U portal -d portal
```

### 시드를 다시 적용해야 할 때

시드 스크립트는 멱등하다. `login_id`가 이미 있으면 건너뛰므로,
**기존 계정의 비밀번호는 갱신되지 않는다.**
초기 비밀번호 정책을 바꾼 뒤 시드 계정에 반영하려면 볼륨까지 지워야 한다.

```bash
docker compose down -v && docker compose up -d
cd backend && uv run alembic upgrade head && uv run python -m app.seed
```

자주 쓰는 쿼리:

```sql
SELECT id, login_id, name, role, status FROM employees;
SELECT id, employee_id, expires_at FROM sessions;
SELECT id, employee_id, status, sent_first_name, sent_last_name FROM background_checks;
```

### 관찰 도구

- 브라우저 **개발자도구 → Network 탭**: 어떤 요청이 나가는지
- **Application 탭 → Cookies**: `SESSIONID` 쿠키 (값은 보이지만 `HttpOnly`라 JS로는 못 읽는다)
- 백엔드 터미널 로그: 외부 API 재시도 등

---

## 1. 로그인

### 해보기

`emp001` / `emp001`로 로그인한다.

### 관찰하기

- Network 탭: `POST /api/auth/login` → 200
- 응답 헤더의 `Set-Cookie: SESSIONID=...; HttpOnly; SameSite=lax`
- 이어서 `GET /api/me`가 자동으로 불린다 (인증 상태 확인)
- DB:
  ```sql
  SELECT id, employee_id, expires_at FROM sessions;
  ```
  방금 로그인한 직원의 세션 1건이 생겼다.

### 흐름

```
LoginPage.tsx
  → api/auth.ts: login()
  → POST /api/auth/login
  → api/auth.py
  → services/auth_service.py: authenticate()
      1. login_id로 직원 조회
      2. 비밀번호 검증 (bcrypt)
      3. status == ACTIVE 확인
      4. 만료 세션 정리
      5. 새 세션 생성 → sessions 테이블 INSERT
      6. 쿠키 설정
  → 앱이 GET /api/me로 사용자 정보 확보 → AuthContext에 저장
```

### 설계 포인트

**세션에는 `employee_id`만 저장한다.** `role`과 `status`는 저장하지 않는다.
매 요청 DB에서 최신 값을 읽는다. 로그인 시점의 값을 캐싱하면 퇴사·권한 변경이 반영되지 않는다.
→ `docs/02-auth-design.md` "세션 설계의 핵심 원칙"

**세션 쿠키는 `HttpOnly`다.** JS가 읽을 수 없어 XSS로 탈취하기 어렵다.
그래서 프론트는 "로그인했는지"를 자체 판단하지 못하고 `GET /api/me`로 확인한다.
→ `docs/02-auth-design.md` "쿠키 설정"

### 스스로 확인

- 왜 JWT가 아니라 서버 세션을 택했는가?
- 세션에 `role`을 저장하면 무엇이 문제가 되는가?

---

## 2. 로그인 실패의 두 얼굴

### 해보기

세 가지를 각각 시도한다.

1. `emp001` / `wrong` (틀린 비밀번호)
2. `nobody` / `x` (없는 아이디)
3. `emp009` / `emp009` (퇴사자)

### 관찰하기

- 1번과 2번의 **에러 메시지가 동일**하다: "아이디 또는 비밀번호가 올바르지 않습니다"
- 3번만 다르다: "퇴사 처리된 계정입니다"
- (심화) Network 탭에서 1번과 2번의 **응답 시간**을 비교한다. 거의 같다.

### 흐름

```
services/auth_service.py: authenticate()
  - 아이디 없음 → 더미 해시로 검증 수행 후 동일 메시지
  - 비밀번호 틀림 → 동일 메시지
  - 검증 통과 후 status 확인 → 퇴사자만 별도 메시지
```

### 설계 포인트

**메시지를 통일하는 이유**: "아이디 없음"과 "비밀번호 틀림"을 구분하면
공격자가 어떤 아이디가 존재하는지 알아낼 수 있다.

**응답 시간도 통일한다**: 아이디가 없을 때 bcrypt 검증을 건너뛰면 응답이 빨라져,
시간만으로 계정 존재 여부가 드러난다. 없는 아이디에도 더미 해시로 검증을 수행해
시간을 맞춘다. (타이밍 공격 방어)

**비밀번호 검증을 status 확인보다 먼저 한다**: 순서를 바꾸면 비밀번호를 모르는 사람도
"이 아이디는 퇴사자다"라는 정보를 얻는다.

### 스스로 확인

- 로그인 실패 메시지를 통일하는 이유는?
- 없는 아이디인데도 왜 bcrypt를 호출하는가?

---

## 3. 내 정보 수정과 필드 방어

### 해보기

`emp001`로 로그인 → 내 정보 화면에서 연락처를 바꾼다.
수정 가능한 필드가 **연락처·주소 둘뿐**임을 확인한다.

### 관찰하기

- Network 탭: `PATCH /api/me`, 요청 바디에 `phone`, `address`만 있다
- 이름·생년월일·부서·역할은 입력란이 없다 (읽기 전용)

**이제 화면을 우회해서 직접 공격해본다.** (이 시스템의 핵심 방어를 확인하는 단계)

```bash
# emp001로 로그인해 쿠키 저장
curl -c c.txt -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" -d '{"login_id":"emp001","password":"emp001"}'

# role을 ADMIN으로 바꾸려는 시도
curl -b c.txt -X PATCH http://localhost:8000/api/me \
  -H "Content-Type: application/json" \
  -d '{"phone":"010-9999-9999","role":"ADMIN","status":"RESIGNED"}'

# 결과 확인
curl -b c.txt http://localhost:8000/api/me
```

### 관찰 결과

`phone`은 바뀌지만 `role`은 여전히 `EMPLOYEE`다. `status`도 그대로다.
**화면에 입력란이 없어도 API는 요청 바디를 받는다. 그런데 무시된다.**

### 흐름

```
PATCH /api/me
  → schemas/employee.py: MeUpdate
     phone, address만 정의됨. role/status는 필드 자체가 없다.
  → 정의되지 않은 필드는 파싱 단계에서 버려진다
  → services/employee_service.py: 명시적으로 phone/address만 대입
```

### 설계 포인트

**스키마 화이트리스트가 방어선이다.** `MeUpdate`에 `role`이 없으므로 들어올 수 없다.
`setattr` 루프로 요청 바디를 순회해 대입하면 이 방어가 뚫린다.
서비스 계층에서도 필드를 명시적으로 대입해 이중으로 막았다.
→ `docs/02-auth-design.md` "필드 수준"

이것이 **화면을 숨기는 것과 서버에서 막는 것의 차이**다.
프론트에 입력란이 없는 것은 UX일 뿐, 보안은 스키마가 한다.

### 스스로 확인

- 직원이 `role: ADMIN`을 보냈는데 왜 반영되지 않는가?
- `setattr(employee, key, value)` 루프가 왜 위험한가?

---

## 4. 직원 목록과 응답 스키마 분리

### 해보기

`admin`으로 로그인 → 직원 목록을 본다. 필터(전체/재직/퇴사)와 검색을 써본다.

### 관찰하기

- Network 탭: `GET /api/employees`, 응답에 **생년월일이 없다**
- `?status=ACTIVE`, `?q=남궁` 붙는 것 확인
- 퇴사자(박퇴사)도 목록에 나온다 — 기본값이 전체다
- 상세를 클릭하면 `GET /api/employees/{id}` — 여기엔 생년월일이 있다

### 흐름

```
목록: GET /api/employees
  → response_model=EmployeeListItem  (생년월일 없음)
상세: GET /api/employees/{id}
  → response_model=EmployeeDetail    (전체 필드)
```

### 설계 포인트

**응답 스키마를 용도별로 나눈다.** 목록에 민감한 필드를 전부 실을 이유가 없다.
목록엔 최소한만, 상세엔 전체. FastAPI의 `response_model`이 자동으로 필터링한다.

**퇴사자를 목록에서 숨기지 않는다.** 소프트 삭제이므로 관리자는 퇴사자도 봐야 한다.
`WHERE status='ACTIVE'`를 기본으로 걸면 이 원칙이 무너진다.
→ `docs/02-auth-design.md` "퇴사 처리는 삭제가 아니다"

### 스스로 확인

- 목록 응답에 생년월일이 없는 이유는?
- 퇴사자를 목록에서 제외하지 않는 이유는?

---

## 5. 직원 등록 — 사번 발급과 중복 방어

### 해보기

관리자 → "직원 등록" → 새 직원을 만든다.
**사번과 비밀번호 입력란이 둘 다 없음**을 확인한다.
등록 후 안내 문구에서 발급된 사번을 읽고, 그 아이디로 로그인해본다.

이어서 **같은 아이디로 또 등록**을 시도한다.

개발자 도구 콘솔에서 사번을 직접 넣어보는 것도 해볼 만하다.

```js
await fetch('/api/employees', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    employee_no: 'HACK-999',
    login_id: 'emp099', name: '주입', date_of_birth: '1995-01-01',
  }),
}).then((r) => r.json())
```

### 관찰하기

- Network 탭: `POST /api/employees`, 요청에 **사번도 비밀번호도 없다**
- 응답의 `employee_no`가 `EMP-{올해}-001`이다. 시드가 `EMP-2024-009`까지 있어도
  올해 접두사로는 처음이므로 `001`부터 시작한다
- 연속 등록하면 `002`, `003`으로 증가한다
- 위 콘솔 요청의 응답 사번은 `HACK-999`가 **아니다**. 스키마에 없는 필드라 무시된다
- 아이디 중복 시 409 "이미 사용 중인 아이디입니다"
- 목록에 `EMP-2024-xxx`와 `EMP-{올해}-xxx`가 섞여 보인다. 정상이다

### 흐름

```
POST /api/employees
  → services/employee_service.py: create_employee()
      1. login_id 사전 조회 (있으면 409)
         employee_no는 검사하지 않는다. 사용자 입력이 아니다
      2. 초기 비밀번호 = INITIAL_PASSWORD, bcrypt 해싱  ← 채번보다 먼저
      3. _next_employee_no(): 올해 접두사로 조회 → 최대 번호 + 1
      4. INSERT
      5. IntegrityError 발생 시 409로 변환 (채번 경쟁 조건)
```

### 설계 포인트

**초기 비밀번호는 고정 상수다**: 처음에는 아이디와 같은 값으로 발급했으나,
브라우저가 유출된 자격증명으로 판단해 경고를 띄웠다.
지금은 `INITIAL_PASSWORD` 한 곳에 정의하고 생성·초기화·시드가 모두 그 값을 쓴다.
값을 화면에 적어두지 않고 응답(`initial_password`)으로 받는 이유도 같다.
백엔드가 값을 바꿨을 때 화면만 옛 값을 안내하는 상황을 막는다.
다만 최초 로그인 시 변경을 강제하지 않는 한계는 남아 있다.
→ `docs/05-data-model.md` "초기 비밀번호"

**중복 검사가 이중이다**: 사전 조회로 흔한 경우를 잡고,
그 사이 경쟁 조건으로 뚫린 경우는 DB 유니크 제약(IntegrityError)이 최종 방어선이 된다.
이제 사용자 입력 식별자는 `login_id` 하나뿐이라 사전 조회도 그것만 본다.
→ `docs/04-external-api-integration.md` "중복 요청 방지"의 DB 제약 논의와 같은 사고

**사번 충돌은 사용자 잘못이 아니다**: 두 관리자가 같은 순간에 등록하면
같은 번호를 읽어 하나가 409를 받는다. 이때 "이미 사용 중인 사번입니다"라고 하면
사번을 입력한 적도 없는 관리자가 무엇을 고쳐야 할지 알 수 없다.
그래서 이 경우만 문구가 다르다 — "사번 발급 중 충돌이 발생했습니다. 다시 시도해 주세요".
재시도는 두지 않았고, 대신 해싱을 채번보다 먼저 해서 창을 좁혔다.
→ `docs/05-data-model.md` "사번 발급"

### 스스로 확인

- 사전 조회로 중복을 확인하는데 왜 IntegrityError 처리도 필요한가?
- `employee_no`를 요청에 넣어도 무시되는 것은 어느 코드가 보장하는가?
- 가장 큰 사번을 `ORDER BY employee_no DESC LIMIT 1`로 찾으면 언제 틀리는가?

---

## 6. 퇴사 처리와 즉시 차단 (핵심)

이 시스템에서 가장 중요한 요구사항이다. **브라우저 두 개**로 실험한다.

### 해보기

1. 일반 브라우저 창: `emp001`로 로그인, 내 정보 화면을 열어둔다
2. 시크릿 창: `admin`으로 로그인, 직원 목록 → 김민준(emp001) 상세 → **퇴사 처리**
3. 확인 다이얼로그 → 처리
4. 다시 일반 창으로 돌아가 아무 동작(새로고침, 저장)을 한다

### 관찰하기

- **일반 창이 즉시 로그인 화면으로 튕긴다.** 재로그인 없이.
- DB로 확인:
  ```sql
  SELECT status FROM employees WHERE login_id='emp001';   -- RESIGNED
  SELECT * FROM sessions WHERE employee_id=2;              -- 0건
  ```
- 일반 창에서 재로그인 시도 → "퇴사 처리된 계정입니다"

### 흐름

```
관리자: POST /api/employees/2/resign
  → services/employee_service.py: resign_employee()
      하나의 트랜잭션 안에서:
        1. status = RESIGNED
        2. DELETE FROM sessions WHERE employee_id = 2
      → 함께 커밋

직원(emp001)의 다음 요청:
  → core/deps.py: get_current_employee()
      세션 조회 → 없음 (방금 삭제됨) → 401
  → 프론트 apiFetch가 401 감지 → 로그인 화면으로
```

### 설계 포인트

**상태 변경과 세션 삭제가 한 트랜잭션이다.** 세션 저장소가 DB이므로 묶을 수 있고,
묶으면 두 저장소가 어긋나는 상황이 원천 차단된다.
→ `docs/02-auth-design.md` "차단 지점"

**"즉시"의 정체**: JWT였다면 토큰 만료까지 차단할 수 없다.
서버 세션을 쓰고 매 요청 확인하기 때문에 다음 요청에서 바로 막힌다.
이것이 세션을 택한 이유다.
→ `docs/02-auth-design.md` "왜 JWT가 아니라 세션인가"

**메시지가 경로마다 다르다**: 퇴사 직후 첫 요청은 "세션이 만료되었습니다"(세션이 이미 없으므로),
재로그인 시도는 "퇴사 처리된 계정입니다". 둘 다 401이다.
→ `docs/02-auth-design.md` "퇴사자가 보는 메시지는 경로에 따라 다르다"

### 스스로 확인

- 상태 변경과 세션 삭제를 왜 한 트랜잭션으로 묶는가?
- JWT를 썼다면 "즉시 차단"이 왜 어려운가?
- 퇴사자가 다시 로그인하는 것은 어디서 막는가? (힌트: 세션 삭제만으로는 부족하다)

---

## 7. 신원조회 — 정상 흐름

### 해보기

관리자 → 김민준(emp001) 상세 → 신원조회 영역 → "신원조회 요청".
결과가 나올 때까지 지켜본다.

### 관찰하기

- Network 탭: `POST /api/employees/2/background-checks` → 201
- 응답의 `status`가 `pending`이면, 이어서 `GET /api/background-checks/{id}`가
  **3초 간격**으로 반복된다 (폴링). 폴링 중에는 요청 버튼이 비활성화된다
- 응답이 곧바로 `clear`/`flagged`면 GET이 **한 번만** 나간다.
  생성 응답에는 세부 결과가 없어, 이 GET이 동기화된 완전한 레코드를 받아온다
- 완료되면 폴링이 멈추고 결과가 표시된다. 목록 배지도 함께 바뀐다
- 결과에 **전송한 이름**(first=민준, last=김)이 함께 보인다
- DB:
  ```sql
  SELECT id, check_id, status, sent_first_name, sent_last_name
  FROM background_checks;
  ```

### 흐름

```
POST .../background-checks
  → services/background_check_service.py: request_check()
      1. 퇴사자 여부 확인
      2. 진행 중(pending) 조회 있으면 409
      3. 이름 모호성 판별 (김민준은 모호하지 않음)
      4. external/name_mapper.py: 김민준 → ("민준", "김")
      5. external/http_client.py: 외부 API 호출 (재시도 포함)
      6. 응답을 background_checks에 INSERT (전송 이름 포함)

폴링: GET /api/background-checks/{내부 PK}
  → get_check(): status가 pending이면 외부에 재확인 → 갱신
```

### 설계 포인트

**3계층 구조**: 브라우저는 외부 API를 직접 부르지 않는다.
백엔드가 중계하며 권한 검증, 민감정보 보호, 재시도를 담당한다.
→ `docs/01-architecture.md`

**DB는 외부 API의 사본**: 결과를 저장해두어 외부가 죽어도 과거 결과를 볼 수 있다.
→ `docs/01-architecture.md` "조회 결과를 DB에 저장하는 이유"

**폴링은 프론트가 한다**: 백엔드가 완료까지 대기하면 요청이 오래 열린다.
프론트가 짧게 물어보고, 응답 후 재예약한다.
→ `docs/04-external-api-integration.md` "폴링"

### 스스로 확인

- 프론트가 외부 API를 직접 부르면 안 되는 이유 네 가지는?
- 조회 결과를 왜 우리 DB에 저장하는가?
- 폴링 도중 탭을 닫으면 결과는 어떻게 되는가?

---

## 8. 신원조회 — 복성 이름

### 해보기

관리자 → **남궁민(emp003)** 상세 → 신원조회 요청.
성 선택 모달이 뜬다. "남궁"을 선택한다.

### 관찰하기

- 첫 요청 `POST .../background-checks`가 **409**로 온다
- 응답 바디가 특이하다:
  ```json
  {"detail": {"code": "AMBIGUOUS_SURNAME", "candidates": ["남", "남궁"], ...}}
  ```
  (다른 에러는 `detail`이 문자열인데 이것만 객체다)
- 모달에서 "남궁" 선택 → `{"surname": "남궁"}`으로 재요청 → 201
- DB에서 전송값 확인:
  ```sql
  SELECT sent_first_name, sent_last_name FROM background_checks
  ORDER BY id DESC LIMIT 1;   -- first=민, last=남궁
  ```

### 흐름

```
POST (surname 없음)
  → name_mapper.is_ambiguous("남궁민") → True
  → 409 + candidates 반환 (시스템이 추측하지 않는다)

POST (surname="남궁")
  → name_mapper.to_external_name("남궁민", "남궁") → ("민", "남궁")
  → 접두사 검증: "남궁민".startswith("남궁") → OK
  → 외부 호출 → 저장
```

### 설계 포인트

**시스템이 추측하지 않는다**: 남궁민은 "남/궁민"일 수도 "남궁/민"일 수도 있다.
규칙으로 판별 불가능하므로 관리자가 확정한다.
여러 조합으로 반복 조회하는 방식은 타인 기록이 매칭될 위험이 있어 배제했다.
→ `docs/03-name-mapping.md`

**전송값을 기록한다**: 확정한 성을 `sent_*`에 남겨 나중에 추적할 수 있다.
`employees` 테이블에는 저장하지 않는다(조회 빈도가 낮아 재사용 가치가 작음).
→ `docs/03-name-mapping.md` "결정"

### 스스로 확인

- 남궁민의 성을 시스템이 자동 판별하지 않는 이유는?
- "여러 조합으로 다 조회해보기"를 배제한 이유는?

---

## 9. 실패 시나리오 재현

외부 API는 평소 잘 동작해서 재시도 코드가 실행되는 걸 보기 어렵다.
가짜 클라이언트로 강제로 실패를 만든다.

### 해보기

백엔드를 실패 모드로 재시작한다.

```bash
# 백엔드 중단 후
USE_FAKE_API=true FAKE_MODE=always_503 uv run uvicorn app.main:app --reload
```

관리자로 신원조회를 요청하고 **백엔드 터미널 로그**를 본다.

### 관찰하기 (모드별)

| 모드 | 관찰 |
|---|---|
| `always_503` | 로그에 재시도 3회, `retryAfter=2` 대기. 화면엔 "일시적으로 응답하지 않습니다" (503 코드 미노출) |
| `always_500` | 백오프 1초 → 2초로 재시도 |
| `fail_then_succeed` | 2회 실패 후 3번째 성공 → 201 |
| `timeout` | POST 타임아웃 → 사전 확인 → 재시도 → 504 |
| `always_pending` | 폴링이 정확히 10회에서 멈추고 "진행 중" 안내 + [다시 확인] 버튼. pending이 있는 동안 요청 버튼 비활성 |
| `always_400` | 재시도 없이 1회로 끝 |

### 설계 포인트

**재시도는 달라질 수 있는 것만**: 503/500/타임아웃은 재시도, 400/404는 즉시 중단.
→ `docs/04-external-api-integration.md` "재시도"

**Fake는 별도 구현체가 아니다**: `HttpClient` + `MockTransport`로 만들어,
재시도 로직이 실제 호출과 **동일한 코드 경로**를 지난다.
독립 구현체였다면 재시도 코드가 실행되지 않아 검증이 무의미해진다.
→ `docs/04-external-api-integration.md` "가짜 클라이언트를 별도 구현체로 만들지 않는다"

**사용자에게 기술 코드를 노출하지 않는다**: 503을 그대로 보여주면
관리자가 우리 시스템 장애로 오해한다.

### 스스로 확인

- 400은 재시도하지 않는데 503은 재시도하는 이유는?
- Fake를 독립 구현체로 만들면 무엇이 문제인가?

**확인 후 실제 API 모드로 되돌린다** (환경변수 없이 재시작, 또는 `USE_FAKE_API=false`).

---

## 10. 권한 경계 — 화면 없이 확인

화면으로는 드러나지 않는 방어를 curl로 확인한다.
"프론트 가드는 보안이 아니다"를 직접 본다.

### 해보기

```bash
# 직원(emp002)으로 로그인
curl -c e.txt -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" -d '{"login_id":"emp002","password":"emp002"}'

# 1. 직원이 관리자 API(전체 목록) 호출
curl -i -b e.txt http://localhost:8000/api/employees
# 기대: 403

# 2. 직원이 타인 상세 조회 (본인은 id=3, 타인 id=4)
curl -i -b e.txt http://localhost:8000/api/employees/4
# 기대: 403

# 3. 직원이 본인 상세 조회
curl -i -b e.txt http://localhost:8000/api/employees/3
# 기대: 200 (본인이므로)

# 4. 직원이 신원조회 요청
curl -i -b e.txt -X POST http://localhost:8000/api/employees/3/background-checks \
  -H "Content-Type: application/json" -d '{}'
# 기대: 403

# 5. 인증 없이 접근
curl -i http://localhost:8000/api/employees
# 기대: 401 (403이 아니다)
```

### 관찰하기

- 관리자 전용 API는 직원 세션으로 403
- 상세 조회는 **본인이면 200, 타인이면 403** (소유권 검사)
- 인증 자체가 없으면 401, 인증은 됐으나 권한이 없으면 403

### 설계 포인트

**인가는 세 층위다**: 역할(관리자 전용), 소유권(본인만), 필드(수정 가능 항목).
`Depends` 체인으로 선언한다.
→ `docs/02-auth-design.md` "인가: 세 층위"

**401과 403의 구분**: 401은 "누군지 모름"(로그인 필요), 403은 "권한 없음".
프론트 처리가 다르다 — 401은 로그인 화면, 403은 안내.

**프론트 가드는 UX일 뿐**: `RequireAdmin`이 화면을 막지만, 그건 사용성이다.
API를 직접 때리면 백엔드가 막는다. 위 curl이 그 증거다.
→ `components/Guards.tsx`의 주석

### 스스로 확인

- 같은 "접근 불가"인데 401과 403은 언제 갈리는가?
- 직원이 본인 상세는 되고 타인 상세는 안 되는 것은 어느 코드가 판단하는가?

---

## 11. 비밀번호 변경과 초기화

### 해보기

`emp001`로 로그인해 "내 정보" 맨 아래 **비밀번호 변경**을 연다.

1. 현재 비밀번호를 틀리게 넣고 변경을 눌러본다
2. 새 비밀번호와 확인란을 다르게 넣어본다 — Network 탭을 열어둔다
3. 제대로 채워 변경한다

이어서 `admin`으로 로그인해 직원 상세에서 **비밀번호 초기화**를 눌러본다.

### 관찰하기

- 1번: 400 "현재 비밀번호가 올바르지 않습니다"
- 2번: **요청이 나가지 않는다.** 확인란 불일치는 브라우저에서 걸러진다
- 3번: 성공 안내가 뜬 뒤 로그인 화면으로 이동한다. 옛 비밀번호로는 로그인되지 않는다
- 초기화: 확인 다이얼로그를 거치고, 안내 문구에 초기 비밀번호가 적혀 있다
- `SELECT employee_id, count(*) FROM sessions GROUP BY employee_id;`
  변경·초기화 대상의 세션이 사라져 있다

### 흐름

```
PATCH /api/me/password
  → services/employee_service.py: change_password()
      1. 현재 비밀번호 대조 (틀리면 400)
      2. 새 값이 현재 값과 같은지 (같으면 400)
      3. bcrypt 해싱 후 저장
      4. auth_service.delete_all_sessions()  ← 본인 세션 포함
      5. 같은 트랜잭션으로 커밋
  → api/me.py: 쿠키까지 만료시킨다

POST /api/employees/{employee_id}/password/reset
  → services/employee_service.py: reset_password()
      1. INITIAL_PASSWORD로 재설정
      2. auth_service.delete_all_sessions()
```

### 설계 포인트

**현재 비밀번호를 요구한다**: 세션 보유는 "지금 이 브라우저를 쓰고 있다"는 증거일 뿐
본인 확인이 아니다. 세션만으로 변경을 허용하면 자리를 비운 사이 계정을 빼앗긴다.

**검증 순서를 바꾸지 않는다**: 현재 비밀번호를 먼저 대조한다.
"새 값이 현재 값과 같다"를 먼저 알려주면, 비밀번호를 모르는 사람이
응답만 보고 값을 맞혀볼 수 있다. 로그인에서 status 검사를 뒤에 두는 것과 같은 이유다.

**본인 세션까지 지운다**: 비밀번호 변경은 대개 "유출된 것 같다"는 상황이다.
다른 기기의 세션이 살아 있으면 변경의 의미가 없다.
→ `docs/02-auth-design.md` "세션을 통째로 지우는 지점은 세 곳이다"

**초기화는 퇴사자와 본인에게도 허용한다**: 퇴사자는 어차피 로그인이 막혀 있어 무해하고,
복직 시나리오를 굳이 배제할 이유가 없다. 관리자가 자신을 초기화하는 것도 막을 근거가 없다.
다만 그 경우 자기 세션도 함께 끊기므로 화면이 미리 경고한다.

**클라이언트 검증은 왕복을 줄일 뿐이다**: 확인란 불일치와 최소 길이는 브라우저에서 걸러지지만,
서버도 똑같이 검사한다. 브라우저를 우회하면 422가 나간다.

### 스스로 확인

- 현재 비밀번호 대조를 "새 값이 현재 값과 같은지" 검사보다 **먼저** 하는 이유는?
- 변경 후 본인 세션을 남겨두면 어떤 상황에서 문제가 되는가?
- 초기 비밀번호 `bit1234`를 프론트에 그대로 적어두지 않고 API로 받아오는 이유는?

---

## 전체 흐름 요약

```
로그인 ─────────────► 세션 생성 (employee_id만)
  │
  ├─ 매 요청 ────────► deps.py: 세션+직원 조인 조회, status·role 최신 확인
  │
직원 ──► /me ────────► 필드 화이트리스트로 수정 제한
  │
관리자 ─► 직원 목록 ─► 응답 스키마 분리 (목록/상세)
  │      직원 등록 ─► 사번 자동발급(EMP-연도-일련), 초기비번=고정상수
  │      퇴사 처리 ─► 상태변경+세션삭제 (한 트랜잭션) → 즉시 차단
  │      비번 초기화 ► 재설정+세션삭제 (본인 변경도 같은 구조)
  │      신원조회 ──► name_mapper → http_client(재시도) → DB 저장 → 프론트 폴링
  │                    복성이면 관리자 확정
  │
외부 API ◄──────────► 3계층 중계, DB는 사본, 실패는 Fake로 검증
```

---

## 더 읽을 것

각 설계 결정의 배경과 배제한 대안은 설계 문서에 있다.

- `docs/00-overview.md` — 문제 분해와 판단 기준
- `docs/01-architecture.md` — 3계층 구조
- `docs/02-auth-design.md` — 인증·인가
- `docs/03-name-mapping.md` — 한글 이름 매핑
- `docs/04-external-api-integration.md` — 외부 연동
- `docs/05-data-model.md` — 데이터 모델
- `docs/06-deployment.md` — 배포
