# 외부 API 연동

## API 스펙 요약

베이스 URL은 환경변수 `BACKGROUND_CHECK_API_URL`로 주입한다.
AWS API Gateway 기반이며 인증이 없고 스테이지 경로가 없다.

```
POST   /background-checks                    조회 요청
GET    /background-checks/{checkId}          결과 조회
GET    /background-checks?employeeId={id}    이력 목록
```

### 요청

```json
POST /background-checks
{
  "employeeId": "EMP-2024-001",
  "firstName": "민준",
  "lastName": "김",
  "dateOfBirth": "1990-03-15"
}
```

네 필드 모두 필수다.

### 응답 (생성)

```json
{
  "checkId": "CHK-a1b2c3d4-...",
  "employeeId": "EMP-2024-001",
  "status": "pending",
  "createdAt": "2025-01-15T09:30:00Z",
  "message": "..."
}
```

### 응답 (상세)

```json
{
  "checkId": "...", "employeeId": "...",
  "firstName": "...", "lastName": "...", "dateOfBirth": "...",
  "status": "clear",
  "criminalRecord": false,
  "educationVerified": true,
  "employmentVerified": true,
  "creditScore": "good",
  "createdAt": "...", "completedAt": "..."
}
```

---

## 스펙에서 읽어낸 함정

### 1. POST 응답의 status가 두 가지다

`pending`일 수도, 바로 `clear` / `flagged`일 수도 있다. **양쪽 분기가 모두 필요하다.**
실측에서 세 값이 모두 관찰되었다.

### 2. 세부 필드가 nullable이다

`criminalRecord`, `educationVerified`, `employmentVerified`, `creditScore`는
"only present when completed"이며 `nullable: true`다.

```javascript
// 잘못된 처리 — pending일 때 "없음"으로 표시된다
result.criminalRecord ? '있음' : '없음'
```

**`true` / `false` / `null` 세 상태로 다뤄야 한다.**

### 3. 목록에는 세부 필드가 없다

`GET /background-checks?employeeId=`는 `status`와 시각만 반환한다.
상세를 보려면 `checkId`로 개별 조회해야 한다.

### 4. POST와 GET이 같은 경로다

메서드로 구분해야 하며, 목록 조회 시 `employeeId`가 없으면 400이다.

### 5. 503만 응답 스키마가 다르다

```json
{
  "error": "Service Unavailable",
  "message": "...",
  "retryAfter": 30,
  "statusCode": 503
}
```

`ErrorResponse`가 아니라 `ServiceUnavailableResponse`로 별도 정의되어 있다.
**`retryAfter`를 읽어 재시도 간격으로 사용해야 한다.**

### 6. status와 세부 결과가 정합하지 않을 수 있다

실측에서 `status: flagged`인데 `criminalRecord: false`인 응답을 관찰했다.
무작위 목이기 때문이다.

**UI에서 자의적으로 해석하지 않는다.** `flagged`는 "추가 검토 필요"이며,
status와 세부 항목을 각각 그대로 표시한다.

---

## 폴링

### 왜 폴링인가

완료까지 시간이 걸리는 작업은 **웹훅이 일반적**이다.
외부 서비스가 완료 시 우리 엔드포인트를 호출해주는 방식으로,
요청 횟수가 1회이고 지연이 없으며 서버 부하도 없다.

그러나 이 API는 콜백 URL 파라미터도, 웹훅 엔드포인트도 제공하지 않는다.
**폴링 외에 선택지가 없다.**

다만 완료까지 약 10초이므로 폴링이 실용적인 범위에 있다.
실제 신원조회처럼 며칠이 걸린다면 폴링은 성립하지 않는다.

### 누가 폴링하는가

| 방식 | 장점 | 단점 |
|---|---|---|
| A. 백엔드가 완료까지 대기 | 프론트가 단순 | HTTP 요청이 10초 이상 열림, 중간 프록시 타임아웃 위험 |
| B. 즉시 응답 후 프론트가 폴링 | 요청이 짧음, 진행 상태 표시 가능 | 프론트에 폴링 로직 필요 |

**B를 채택한다.** 장시간 열린 요청은 브라우저·프록시·로드밸런서 등 여러 지점에서 끊길 수 있다.
"조회 중" 상태를 화면에 표시할 수 있는 것도 이점이다.

탭을 닫으면 폴링이 중단되지만, `checkId`가 저장되어 있으므로 나중에 다시 확인하면 된다.

### 파라미터

| 항목 | 값 | 근거 |
|---|---|---|
| 폴링 간격 | 3초 | 완료가 약 10초이므로 3~5회면 종료 |
| 최대 횟수 | 10회 | 약 30초 후 중단 |
| 중단 시 처리 | `pending` 상태로 유지 | 실패가 아니라 미완료다 |

**중단해도 데이터를 버리지 않는다.** `checkId`는 유효하므로 다음 조회 시 재확인한다.

---

## 재시도

### 원칙

> **재시도해서 결과가 달라질 수 있는 것만 재시도한다.**

| 응답 | 재시도 | 근거 |
|---|---|---|
| 503 + `retryAfter` | 예 | 서버가 대기 시간을 명시했다 |
| 500 | 예 | 일시적일 수 있다 |
| 타임아웃 | 조건부 | 아래 별도 설명 |
| 400 | 아니오 | 요청이 잘못되었다. 반복해도 같다 |
| 404 | 아니오 | 존재하지 않는다 |
| `clear` / `flagged` | 아니오 | 정상 응답이다 |

### 503 처리

```python
if resp.status_code == 503:
    wait = resp.json().get("retryAfter", 5)
    await asyncio.sleep(wait)
```

서버가 알려준 값을 존중한다. 임의의 고정 간격을 쓰면 스펙이 제공한 정보를 무시하는 것이다.

### 500 처리

대기 시간 정보가 없으므로 **지수 백오프**를 적용한다: 1초 → 2초 → 4초.
서버가 부하 상태일 때 동일 간격으로 반복 호출하면 상황을 악화시킨다.

### 재시도 횟수

**3회.** 그 이상은 사용자 대기 시간만 늘린다.

### 타임아웃

**10초.** POST는 접수만 하므로 정상이라면 1초 이내에 응답한다.
너무 짧으면 정상 요청을 실패로 처리하고, 너무 길면 사용자가 오래 대기한다.

---

## 타임아웃이 특별한 이유

500과 503은 **서버가 응답한** 것이다. 실패했다는 사실이 확인된다.

타임아웃은 **응답이 없는** 것이다. 서버 상태를 알 수 없다.

```
요청 전송 → 10초 무응답 → 타임아웃
```

이때 서버는 다음 중 하나다.

- 요청을 받지 못함 (재시도해도 안전)
- 받아서 처리 중 (재시도하면 중복)
- 이미 처리 완료 (재시도하면 확실히 중복)

**구분할 방법이 없다.** 이 API에는 멱등성 키(`Idempotency-Key` 헤더 등)가 없어
서버 측에서 중복을 걸러줄 수도 없다.

### 완화 방법

재시도 전에 이미 생성되었는지 확인한다.

```python
try:
    return await client.create(req)
except httpx.TimeoutException:
    await asyncio.sleep(2)
    existing = await client.list_by_employee(req.employee_id)
    recent = find_recent(existing, within_seconds=30)
    if recent:
        return recent          # 방금 생성된 것이 있으면 재사용
    return await client.create(req)
```

완전하지 않다. 확인하는 순간에도 처리 중일 수 있다.
**멱등성 키가 없는 이상 완전한 방어는 불가능하며, 이를 인지하고 완화하는 것이 최선이다.**

---

## 중복 요청 방지

### 발생 시나리오

| 시나리오 | 설명 |
|---|---|
| 더블클릭 | 버튼을 빠르게 두 번 클릭 |
| 진행 중 재요청 | pending 상태에서 답답해 다시 클릭 |
| 동시 요청 | 관리자 두 명이 같은 직원을 동시에 조회 |
| 타임아웃 재시도 | 위 절에서 설명 |

### 채택한 방어

**1. 프론트: 요청 중 버튼 비활성화**

가장 흔한 더블클릭을 막는다. 보안 수단은 아니다.

**2. 백엔드: 진행 중 조회 검사**

```python
existing = await db.scalar(
    select(BackgroundCheck).where(
        BackgroundCheck.employee_id == employee_id,
        BackgroundCheck.status == "pending",
    )
)
if existing:
    raise HTTPException(409, "이미 진행 중인 조회가 있습니다")
```

### 채택하지 않은 방어

**부분 유니크 인덱스 / DB 선점 패턴**

경쟁 조건(두 요청이 밀리초 단위로 겹쳐 둘 다 검사를 통과하는 상황)까지 막으려면
DB 제약이나 선점 패턴이 필요하다.

배제 근거:

- 관리자 수가 적고 신원조회는 직원당 1~3회 수준이라 **발생 확률이 극히 낮다**
- 발생해도 **이력이 하나 더 쌓이는 정도**로, 데이터 정합성이 깨지지 않는다
- 선점 패턴은 상태 전이(선점 → 호출 → 확정, 실패 시 반납)와
  좀비 레코드 정리까지 필요해 **복잡도 증가가 이득을 초과한다**

참고: 유니크 인덱스만 추가하고 선점 패턴을 쓰지 않으면, 제약이 API 호출 **이후**에 걸린다.
외부 호출은 이미 발생한 뒤이므로 비용 절감 효과가 없고 데이터 중복만 막는다.
그런데 데이터 중복 자체는 큰 문제가 아니므로 실익이 없다.

---

## 실패 시나리오 검증

### 문제

재시도·폴링 코드를 작성하고도 **한 번도 실행해보지 못하는** 경우가 흔하다.
개발 중에 503이 발생하지 않으면 그 경로는 검증되지 않은 채 배포된다.

### 해결: 클라이언트 추상화

```python
class BackgroundCheckClient(Protocol):
    async def create(self, req: CheckRequest) -> CheckResponse: ...
    async def get(self, check_id: str) -> CheckResult: ...
    async def list_by_employee(self, employee_id: str) -> list[CheckSummary]: ...
```

구현체 둘을 두고 환경변수로 전환한다.

```python
def get_check_client() -> BackgroundCheckClient:
    if settings.USE_FAKE_API:
        return FakeClient(mode=settings.FAKE_MODE)
    return HttpClient(settings.BACKGROUND_CHECK_API_URL)
```

```bash
USE_FAKE_API=true FAKE_MODE=always_503 uv run uvicorn app.main:app
```

### 추상화 기준에 대한 보충

세션 저장소는 추상화하지 않기로 했는데 여기는 추상화한다. 기준이 다르지 않다.

| 대상 | 교체 시나리오 | 판단 |
|---|---|---|
| 세션 저장소 | 미래의 가정 (Redis로 갈지 모름) | 추상화하지 않음 |
| 외부 API 클라이언트 | **현재 필요** (실패 재현) | 추상화함 |

전자는 투기이고 후자는 실용이다.

### 가짜 클라이언트 모드

| 모드 | 동작 |
|---|---|
| `normal` | 정상 응답 |
| `always_503` | 항상 503 + retryAfter |
| `always_500` | 항상 500 |
| `timeout` | 응답 지연으로 타임아웃 유발 |
| `always_pending` | 영원히 pending 유지 |
| `fail_then_succeed` | 2회 실패 후 성공 (재시도 복구 경로 확인) |

### 검증 항목

| 시나리오 | 확인할 것 |
|---|---|
| 503 반복 | `retryAfter`만큼 대기하는가, 3회 후 중단하는가 |
| 503 → 성공 | 재시도로 복구되는가 |
| 500 반복 | 백오프 간격이 증가하는가 |
| 타임아웃 | 사전 확인 후 재시도하는가 |
| 영원한 pending | 폴링이 최대 횟수에서 멈추는가 |
| pending → clear | 폴링이 정상 종료되는가 |
| 400 / 404 | **재시도하지 않고** 즉시 실패하는가 |

마지막 항목이 특히 중요하다. 모든 에러를 재시도하도록 작성하기 쉽다.

### 부가 효과

가짜 클라이언트가 있으면 UI 개발이 빨라진다.
10초를 기다리거나 무작위 응답에 휘둘리지 않고 원하는 상태를 즉시 재현할 수 있다.
외부 API가 다운되어도 개발이 중단되지 않는다.

---

## 사용자에게 보여줄 메시지

기술적 에러를 그대로 노출하지 않는다.
외부 API 장애를 우리 시스템 장애로 오인하게 만들기 때문이다.

| 상황 | 문구 |
|---|---|
| 진행 중 | 조회 중입니다... |
| 완료 | 결과 표시 |
| 폴링 시간 초과 | 외부 서비스 응답이 지연되고 있습니다. 잠시 후 다시 확인해 주세요. |
| 재시도 실패 | 일시적으로 조회할 수 없습니다. 잠시 후 다시 시도해 주세요. |
| 400 | 직원 정보가 올바르지 않습니다. |
| 409 | 이미 진행 중인 조회가 있습니다. |

---

## 설정값 정리

한곳에 모아 관리한다.

| 항목 | 값 |
|---|---|
| HTTP 타임아웃 | 10초 |
| 재시도 횟수 | 3회 |
| 500 백오프 | 1s → 2s → 4s |
| 503 대기 | 응답의 `retryAfter` |
| 폴링 간격 | 3초 |
| 폴링 최대 횟수 | 10회 |

`httpx.AsyncClient`는 애플리케이션 수명 동안 재사용한다(lifespan에 등록).
요청마다 생성하면 커넥션 풀의 이점이 사라진다.

동기 HTTP 라이브러리(`requests`)를 사용하면 이벤트 루프가 차단되어
느린 외부 호출 하나가 서버 전체를 멈춘다. 반드시 async 클라이언트를 사용한다.
