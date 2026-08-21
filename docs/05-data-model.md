# 데이터 모델

사내 직원 관리 시스템의 데이터베이스 스키마 설계 문서.
각 컬럼의 선택 근거는 주석과 하단 "설계 결정" 절에 기록한다.

---

## 개요

테이블 3개로 구성한다.

| 테이블 | 역할 |
|---|---|
| `employees` | 직원 정보 + 계정 정보 |
| `sessions` | 로그인 세션 |
| `background_checks` | 외부 신원조회 요청·결과 사본 |

```
employees 1 ──── * sessions
    │
    ├─ 1 ──── * background_checks (employee_id: 조회 대상)
    └─ 1 ──── * background_checks (created_by:  요청한 관리자)
```

---

## 1. employees

직원과 계정을 한 테이블로 관리한다. 관리자도 직원이며 `role`만 다르다.

```sql
CREATE TABLE employees (
    -- 내부 PK. 사번 체계가 바뀌어도 FK가 흔들리지 않도록 업무 식별자와 분리한다.
    id            SERIAL       PRIMARY KEY,

    -- 업무용 사번. 외부 Background Check API의 employeeId로 전달된다.
    -- 외부 시스템에 노출되므로 생년월일 등 개인정보가 포함되지 않는 무의미한 일련번호를 사용한다.
    employee_no   VARCHAR(20)  NOT NULL UNIQUE,

    -- 로그인 아이디. 초기 비밀번호는 이 값과 무관한 고정 상수다.
    login_id      VARCHAR(50)  NOT NULL UNIQUE,

    -- bcrypt 해시. 평문 저장 금지.
    password_hash VARCHAR(255) NOT NULL,

    -- 한글 통성명. 성/이름을 분리 저장하지 않는다.
    -- 외부 API 전송 시에만 중계 계층에서 분리하며, 분리 결과는 background_checks에 기록한다.
    name          VARCHAR(50)  NOT NULL,

    -- 외부 API 필수 파라미터. 동명이인을 구분하는 실질적 식별 키이므로 NOT NULL.
    date_of_birth DATE         NOT NULL,

    -- 직원 본인이 수정 가능한 필드
    phone         VARCHAR(20),
    address       VARCHAR(200),

    -- 관리자만 수정 가능한 필드
    department    VARCHAR(50),
    position      VARCHAR(50),

    -- 권한. 직원 본인은 수정할 수 없다(요청 스키마에서 제외).
    role          VARCHAR(10)  NOT NULL DEFAULT 'EMPLOYEE',

    -- 재직 상태. 퇴사 시 물리 삭제하지 않고 이 값을 RESIGNED로 변경한다.
    status        VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE',

    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- SQLAlchemy의 onupdate=func.now()로 갱신한다. PostgreSQL은 자동 갱신하지 않는다.
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- ENUM 타입 대신 문자열 + CHECK를 사용한다.
    -- ENUM은 값 추가 시 마이그레이션이 번거로우며, 이 규모에서는 이점이 없다.
    CONSTRAINT ck_employees_role   CHECK (role   IN ('EMPLOYEE', 'ADMIN')),
    CONSTRAINT ck_employees_status CHECK (status IN ('ACTIVE', 'RESIGNED'))
);

-- 로그인 시 조회
CREATE INDEX idx_employees_login_id ON employees(login_id);
```

### 필드별 수정 권한

인가 설계와 직결된다. 요청 스키마(Pydantic)를 직원용/관리자용으로 분리해 강제한다.

| 필드 | 직원 본인 | 관리자 |
|---|---|---|
| `phone`, `address` | 수정 가능 | 수정 가능 |
| `name`, `date_of_birth`, `employee_no` | 조회만 | 수정 가능 |
| `department`, `position` | 조회만 | 수정 가능 |
| `role`, `status` | **접근 불가** | 수정 가능 |

직원용 수정 스키마에는 `role`·`status` 필드를 아예 정의하지 않는다.
화면에 입력란이 없어도 API는 요청 바디를 받으므로, 스키마 화이트리스트가 실질적인 방어선이다.

---

## 2. sessions

서버 세션 방식. 세션에는 신원(`employee_id`)만 저장하고,
권한과 재직 상태는 매 요청 `employees`에서 최신 값을 조회한다.

```sql
CREATE TABLE sessions (
    -- secrets.token_urlsafe(32) 로 생성한 세션 ID. 쿠키에 담긴다.
    id          VARCHAR(64) PRIMARY KEY,

    -- 세션의 주인.
    -- 주의: role, status를 여기 복사해두지 않는다.
    -- 로그인 시점의 스냅샷이 되어 퇴사·권한 변경이 반영되지 않기 때문이다.
    employee_id INTEGER     NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);

-- 퇴사 처리 시 DELETE FROM sessions WHERE employee_id = ? 를 위한 인덱스.
-- 이 컬럼이 없으면 세션 데이터가 JSON에 묻혀 userId로 역검색할 수 없다.
CREATE INDEX idx_sessions_employee ON sessions(employee_id);
```

### 인증 흐름

```
쿠키의 SESSIONID
  → sessions JOIN employees 로 한 번에 조회
  → expires_at 확인
  → employees.status 확인 (ACTIVE가 아니면 401 + 세션 삭제)
  → employees.role 로 인가 판단
```

세션과 직원 정보를 조인 한 번으로 가져오므로 왕복은 1회다.

### 만료 세션 정리

별도 배치는 두지 않는다. 로그인 시 해당 사용자의 만료 세션을 함께 삭제하는 정도로 충분하다.

---

## 3. background_checks

외부 API가 진실의 원천이고, 이 테이블은 사본이다.
외부 API가 응답하지 않아도 과거 결과를 조회할 수 있어야 하므로 저장한다.

```sql
CREATE TABLE background_checks (
    id              SERIAL       PRIMARY KEY,

    -- 조회 대상 직원
    employee_id     INTEGER      NOT NULL REFERENCES employees(id),

    -- 외부 API가 발급한 checkId (예: CHK-a1b2c3d4-...).
    -- API 응답을 받은 후에만 INSERT하므로 NOT NULL이다.
    check_id        VARCHAR(100) NOT NULL UNIQUE,

    -- pending | clear | flagged
    -- flagged는 "불합격"이 아니라 "추가 검토 필요"를 뜻한다. 자의적으로 재해석하지 않는다.
    status          VARCHAR(10)  NOT NULL,

    -- 외부로 실제 전송한 이름. 감사·추적 목적.
    -- 복성 이름(남궁민 등)은 관리자가 조회 시점에 성을 확정하며, 그 결과가 여기 남는다.
    -- employees 테이블에 확정값을 저장하지 않는 대신 이 기록으로 추적한다.
    sent_first_name VARCHAR(50)  NOT NULL,
    sent_last_name  VARCHAR(50)  NOT NULL,

    -- 완료 시에만 채워지는 결과 필드. pending이면 NULL.
    -- NULL과 false는 다른 의미다. UI에서 NULL을 "없음"으로 표시하지 않도록 주의한다.
    criminal_record     BOOLEAN,
    education_verified  BOOLEAN,
    employment_verified BOOLEAN,
    credit_score        VARCHAR(10),

    -- 우리 시스템이 요청한 시각
    requested_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- 외부 API의 completedAt. pending이면 NULL.
    completed_at    TIMESTAMPTZ,

    -- 요청한 관리자. 민감정보 접근 기록으로서 최소한의 감사 추적을 남긴다.
    created_by      INTEGER      NOT NULL REFERENCES employees(id),

    CONSTRAINT ck_checks_status CHECK (status IN ('pending', 'clear', 'flagged')),
    CONSTRAINT ck_checks_credit CHECK (
        credit_score IS NULL OR credit_score IN ('excellent', 'good', 'fair', 'poor')
    )
);

-- 직원별 조회 이력
CREATE INDEX idx_checks_employee ON background_checks(employee_id);
```

### 상태 동기화

폴링이 최대 횟수를 넘겨 중단되면 우리 DB에는 `pending`이 남지만 외부에서는 완료되었을 수 있다.

**처리 방식**: 상세 조회 시 **로컬 상태가 `pending`이거나 `completed_at`이 비어 있으면**
외부 API에 재확인하고 결과를 갱신한다.

조건이 `pending` 하나가 아닌 이유가 있다.
POST가 곧바로 `clear`/`flagged`를 반환하는 경우가 있는데, 그 응답에는 세부 결과가 담기지 않는다.
`pending`만 동기화 대상으로 삼으면 이런 레코드의 세부 필드가 영원히 `NULL`로 남아
상세 화면이 비어 보인다. `completed_at`을 함께 보면 두 경우가 모두 처리된다.
한 번 채워진 뒤에는 재호출하지 않는다.

별도의 `timeout` 상태를 만들지 않는다. 상태가 늘어나면 화면과 로직이 함께 복잡해지고,
실제로는 "아직 확인 중"과 구분할 실익이 없기 때문이다.

### 중복 방지

부분 유니크 인덱스나 선점 패턴은 두지 않는다.

- 관리자 수가 적고 신원조회는 직원당 1~3회 수준이라 동시 요청 확률이 극히 낮다
- 중복이 발생해도 이력이 하나 더 쌓이는 정도로, 데이터 정합성이 깨지지 않는다
- 실제로 자주 발생하는 것은 더블클릭과 재클릭이며, 이는 아래로 충분히 막힌다
  - 프론트: 요청 중 버튼 비활성화
  - 백엔드: 진행 중(`pending`) 조회가 있으면 409 반환

---

## 설계 결정 요약

| 결정 | 근거 |
|---|---|
| 이름을 통이름 하나로 저장 | 과제 지침. 분리는 외부 전송 시에만 수행 |
| `surname_override` 컬럼 없음 | 신원조회 빈도가 낮아 재사용 가치가 작음. 조회 시점에 관리자가 확정 |
| 전송한 이름을 `background_checks`에 기록 | 어차피 필요한 테이블이며, 외부 전송값 기록은 연동 시스템의 기본 |
| 세션에 `role`·`status` 미저장 | 로그인 시점 스냅샷이 되어 퇴사·권한 변경이 반영되지 않음 |
| 퇴사를 상태 변경으로 처리 | 근로기준법상 근로자 명부 3년 보존 의무. 접근 차단과 데이터 파기는 별개 행위 |
| `date_of_birth` NOT NULL | 외부 API 필수 파라미터이자 동명이인 구분의 실질적 키 |
| `id`와 `employee_no` 분리 | 사번 체계 변경 시 FK 영향 차단 |
| ENUM 대신 VARCHAR + CHECK | 값 추가 시 마이그레이션 부담 회피 |
| 조회 결과를 DB에 저장 | 외부 API 장애 시에도 과거 결과 조회 가능해야 함 |

---

## 미결 사항

### 초기 비밀번호

초기 비밀번호는 **고정 상수 `bit1234`**다.
`app/core/security.py`의 `INITIAL_PASSWORD` 한 곳에만 두고,
계정 생성·관리자 초기화·시드 세 경로가 모두 그 값을 참조한다.

**아이디와 동일하게 두지 않는 이유.**
처음에는 초기 비밀번호를 로그인 아이디와 같게 발급했다.
관리자가 비밀번호를 따로 정하거나 전달할 필요가 없다는 장점이 있었지만,
브라우저가 이 조합을 유출된 자격증명으로 판단해 경고를 띄웠다.
아이디를 아는 사람이 곧 비밀번호를 아는 것과 같다는 문제도 그대로였다.

**변경 수단을 함께 제공한다.**

| 경로 | 권한 | 결과 |
|---|---|---|
| `PATCH /api/me/password` | 본인 | 현재 비밀번호 확인 후 변경 |
| `POST /api/employees/{employee_id}/password/reset` | 관리자 | `INITIAL_PASSWORD`로 되돌림 |

직원 변경 시 **현재 비밀번호를 요구한다.** 세션 보유는 "지금 이 브라우저를 쓰고 있다"는
증거일 뿐 본인 확인이 아니다. 세션만으로 변경을 허용하면 자리를 비운 사이
타인이 비밀번호를 바꿔 계정을 가져갈 수 있다.

**두 경로 모두 해당 직원의 모든 세션을 삭제한다.** 비밀번호 변경은 대개
"유출된 것 같다"는 상황에서 일어나므로 다른 기기의 세션이 살아 있으면 변경의 의미가 없다.
초기화도 마찬가지로, 기존 세션이 남으면 그 직원이 계속 접근할 수 있어 초기화가 반쯤 무의미해진다.
본인도 로그아웃되지만 새 비밀번호로 다시 로그인하는 것이 자연스럽다.

**최소 길이는 4자다.** 복잡도 규칙(대소문자·숫자·기호 조합)은 두지 않았다.

**남는 한계: 최초 로그인 시 변경을 강제하지 않는다.**
고정 상수는 아이디와 같은 값보다 낫지만, 바꾸지 않은 계정이 전부 같은 비밀번호를
쓴다는 점은 그대로다. 강제하려면 `must_change_password BOOLEAN NOT NULL DEFAULT true`
컬럼과 변경 화면·리다이렉트 흐름이 필요하다.
과제 범위를 고려해 도입하지 않으며, 이 한계를 README에 명시한다.

`bit1234`는 공개된 유출 비밀번호 목록에도 존재하는 값이다.
브라우저 경고를 확실히 피하려면 목록에 없는 값으로 바꾸는 것이 낫다.

### 로그인 시도 횟수 제한 없음

초기 비밀번호가 모든 계정에서 같은 값이라 무차별 대입에 취약하다.
아이디를 아는 사람이 자동화 도구로 반복 시도하는 것을 막을 장치가 없다.

실제 운영 환경이라면 시도 횟수 제한이나 계정 잠금이 필요하다.
과제 범위를 고려해 도입하지 않았다.

### CSRF 대책이 쿠키 속성에만 의존함

세션 쿠키에 `SameSite=Lax`를 적용해 교차 사이트 요청에서 쿠키가 전송되지 않도록 했다.
대부분의 CSRF를 막지만 완전하지는 않다.

상태를 변경하는 요청에 CSRF 토큰을 함께 검증하는 것이 온전한 방어이나,
단일 도메인 구성과 `SameSite=Lax`로 실질적 위험이 낮다고 판단해 도입하지 않았다.

이 판단은 배포 구성에 의존한다는 점에 유의한다.
프론트와 백엔드를 다른 도메인에 배포하면 `SameSite=None`이 필요해지고,
그 순간 이 방어가 사라지므로 CSRF 토큰이 필수가 된다(`01-architecture.md` 참조).
