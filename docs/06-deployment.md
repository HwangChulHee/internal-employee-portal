# 배포

## 왜 배포가 필수인가

요구사항에 "cloud를 적극 활용", "완성된 앱을 실제로 사용해 보며 평가"가 명시되어 있다.
로컬에서만 동작하면 평가 자체가 불가능하다.

**우선순위상 가장 높다.** 기능이 완벽해도 접속할 수 없으면 평가받지 못하고,
기능이 부족해도 동작하면 평가는 받는다.

---

## 구성

```
GitHub push
    ↓  GitHub Actions
이미지 빌드 → GHCR 푸시
    ↓
EC2
 ├─ Nginx (80/443, HTTPS 종료, 리버스 프록시)
 ├─ 애플리케이션 컨테이너 (FastAPI + React 정적 파일)
 └─ PostgreSQL 컨테이너 (볼륨 마운트)
```

---

## 결정 사항

### 단일 서버, 단일 도메인

FastAPI가 React 빌드 결과물을 정적 파일로 서빙한다.

```
https://example.com          → React
https://example.com/api/*    → FastAPI
```

**이유**: 세션 쿠키를 사용하므로 same-origin이 유리하다.
프론트와 백엔드를 다른 도메인에 배포하면 `samesite="none"`이 필요해지고,
CSRF 방어가 약화되어 별도 대책이 필요해진다.

부수적으로 CORS 설정 문제도 사라진다.

**아직 구현되어 있지 않다.** Dockerfile은 React 빌드 결과를 `/app/static`으로
복사하지만, `main.py`에 `StaticFiles` 마운트가 없다. 배포 전에 마운트와 함께
**SPA 폴백**을 붙여야 한다 — 클라이언트 라우팅을 쓰므로 `/admin/employees/2`에서
새로고침하면 백엔드가 그 경로를 모르고 404를 반환한다.
개발 중에는 Vite가 처리해 주어 드러나지 않는다.

### 빌드는 GitHub Actions에서

**아직 구현되어 있지 않다.** 저장소에 `.github/` 워크플로가 없다.
아래는 배포 시 따를 계획이다.

EC2에서 `docker compose up --build`를 실행하는 방식은 채택하지 않는다.

**이유**: 작은 인스턴스에서 React 빌드는 메모리를 많이 사용해 OOM으로 실패할 수 있다.
Actions에서 빌드해 GHCR에 푸시하고, EC2는 `pull`만 수행한다.

부수적 이점: EC2에 SSH 접속이 필요 없어 보안 그룹에서 22번 포트를 상시 개방하지 않아도 된다.

### DB는 EC2 내 컨테이너

RDS를 사용하지 않는다.

**이유**: 200명 규모에 관리형 DB의 이점이 크지 않고 관리 지점만 늘어난다.

**주의**: 볼륨을 반드시 마운트한다. 없으면 컨테이너 재생성 시 시드 데이터가 소실된다.

```yaml
volumes:
  - pgdata:/var/lib/postgresql/data
```

### 보안 그룹

| 포트 | 개방 범위 |
|---|---|
| 80, 443 | 전체 |
| 22 | 본인 IP만 (필요 시) |
| 5432 | **개방하지 않음** |

DB는 Docker 네트워크 내부 통신으로 충분하다. 외부에 노출할 이유가 없다.

---

## 환경변수

시크릿은 코드에 포함하지 않는다. `.env`는 `.gitignore`에 두고 `.env.example`만 커밋한다.

| 변수 | 로컬 | 배포 |
|---|---|---|
| `DATABASE_URL` | localhost | 컨테이너 이름 |
| `SESSION_SECRET` | 임의 값 | 강한 랜덤 값 |
| `COOKIE_SECURE` | `false` | `true` |
| `BACKGROUND_CHECK_API_URL` | 실제 URL | 실제 URL |
| `USE_FAKE_API` | 필요 시 `true` | `false` |
| `FAKE_MODE` | 재현할 실패 모드 | `normal` |
| `CORS_ORIGINS` | localhost:5173 | 배포 도메인 |

재시도 관련 값(`EXTERNAL_TIMEOUT_SECONDS`, `EXTERNAL_MAX_RETRIES`,
`EXTERNAL_BACKOFF_BASE_SECONDS`, `EXTERNAL_DEFAULT_RETRY_AFTER`)은
코드에 기본값이 있어 환경별로 다르게 줄 필요가 없다. 조정이 필요할 때만 재정의한다.

**`COOKIE_SECURE`가 분리된 이유**: 로컬은 HTTP이므로 `secure=True`를 켜면
브라우저가 쿠키를 전송하지 않아 로그인이 동작하지 않는다.

`.env.example`에 외부 API URL 실제 값을 넣지 않는다.
저장소가 공개되어 있으면 제3자가 검색으로 접근할 수 있다.

---

## 마이그레이션

Alembic으로 스키마를 관리하고, 배포 시 자동 실행한다.

```
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**아직 구현되어 있지 않다.** Dockerfile의 `CMD`는 uvicorn만 실행하고
`docker-compose.yml`에는 `db` 서비스만 있다. 배포 시 위 형태로 바꾸거나
엔트리포인트 스크립트로 분리해야 한다.

---

## 시드 데이터

**평가자가 접속했을 때 빈 화면이면 아무것도 확인할 수 없다.**

평가 시나리오를 미리 고려해 준비한다.

실제 시드는 10명이다(`backend/app/seed.py`).

| 계정 | 수 | 목적 |
|---|---|---|
| 관리자 | 1명 | 관리자 기능 전반 |
| 재직 직원 | 7명 | 일반 흐름, 목록 페이징 |
| **퇴사자** | 2명 | 접근 차단 로직 확인, 퇴사 필터 |
| **복성 직원** (남궁민) | 위 7명 중 1명 | 이름 매핑 확인 |

퇴사자와 복성 직원이 특히 중요하다.
없으면 공들여 구현한 두 로직을 평가자가 확인할 방법이 없다.

README에 테스트 계정을 명시한다.

```
관리자: admin  / bit1234
직원:   emp001 / bit1234
퇴사자: emp009 / bit1234   ← 로그인 차단 확인용
```

초기 비밀번호는 고정 상수 `bit1234`다 (`05-data-model.md` 참조).
직원은 로그인 후 스스로 바꿀 수 있고, 관리자는 이 값으로 되돌릴 수 있다.

시드는 멱등하므로 이미 있는 계정의 비밀번호는 갱신하지 않는다.
정책을 바꾼 뒤 반영하려면 볼륨까지 지우고 다시 시드해야 한다.

---

## HTTPS

도메인 구입 후 Let's Encrypt로 발급한다.
HTTPS 없이는 `COOKIE_SECURE=true`를 사용할 수 없다.

---

## 진행 순서

**초기에 빈 껍데기라도 한 번 배포해본다.**

```
1단계: 헬스체크만 있는 상태로 배포 파이프라인 완성
       → DB 연결, 환경변수, HTTPS 확인
2단계: 기능 개발하며 지속적으로 푸시
3단계: 시드 데이터, README 정리
```

배포 단계의 문제는 대부분 로컬과 다른 환경(드라이버, 경로, 환경변수)에서 발생한다.
마지막에 몰아서 하면 반드시 시간이 부족해진다.

---

## 실패 시나리오 시연

평가자가 재시도 로직을 직접 확인할 수 있도록 README에 명령을 남긴다.

```bash
USE_FAKE_API=true FAKE_MODE=always_503 uv run uvicorn app.main:app
```

코드에 재시도 로직이 있다는 주장보다, 실제로 재현할 수 있다는 것이 강한 근거가 된다.
