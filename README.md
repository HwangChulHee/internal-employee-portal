# Internal Employee Portal

사내 임직원 포털. FastAPI + React 기반.

## 요구 사항

- Python 3.12, [uv](https://docs.astral.sh/uv/)
- Node 20 이상
- Docker (로컬 PostgreSQL 용)

## 실행 방법

### 1. 환경변수 준비

```bash
cp .env.example backend/.env
```

`.env`는 커밋하지 않는다.

### 2. DB 기동

```bash
docker compose up -d
```

### 3. 백엔드

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

- 헬스체크: http://localhost:8000/api/health
- API 문서: http://localhost:8000/docs

### 4. 프론트엔드

```bash
cd frontend
npm install
npm run dev
```

http://localhost:5173 에서 확인한다. `/api` 요청은 Vite 프록시를 통해
백엔드(8000)로 전달되므로 로컬에서도 same-origin으로 동작한다.

## 초기 데이터

```bash
cd backend
uv run alembic upgrade head
uv run python -m app.seed
```

시드는 직원 10명(관리자 1, 재직 7, 퇴사 2)을 만든다.
초기 비밀번호는 모두 `bit1234`이며, 새로 만드는 계정도 같은 값으로 발급된다.

시드는 멱등하다. `login_id`가 이미 있으면 건너뛰므로 **기존 계정의 비밀번호는
갱신되지 않는다.** 정책을 바꾼 뒤 반영하려면 볼륨까지 지우고 다시 시드한다.

```bash
docker compose down -v && docker compose up -d
```

## 알려진 한계

과제 범위를 고려해 도입하지 않은 것들이다. 근거는 `docs/`에 있다.

- **최초 로그인 시 비밀번호 변경을 강제하지 않는다.** 직원이 스스로 바꿀 수
  있고 관리자가 초기화할 수 있지만, 바꾸지 않은 계정은 모두 같은 초기
  비밀번호를 쓴다 (`docs/05-data-model.md`)
- **로그인 시도 횟수 제한이 없다** (`docs/05-data-model.md`)
- **CSRF 방어가 쿠키 속성(`SameSite=Lax`)에만 의존한다.** 프론트와 백엔드를
  다른 도메인에 배포하면 이 방어가 사라진다 (`docs/01-architecture.md`)
- **정적 파일 서빙(SPA 폴백)이 아직 없다.** 배포 시 필요하다
  (`docs/06-deployment.md`)

## 마이그레이션

```bash
cd backend
uv run alembic revision --autogenerate -m "설명"
uv run alembic upgrade head
```

## 디렉토리

| 경로 | 역할 |
|---|---|
| `backend/app/models/` | SQLAlchemy 모델 (DB 테이블) |
| `backend/app/schemas/` | Pydantic 스키마 (API 입출력) |
| `backend/app/api/` | 라우터 |
| `backend/app/core/` | 인증·인가 의존성, 보안 유틸 |
| `backend/app/services/` | 비즈니스 로직 |
| `backend/app/external/` | 외부 API 클라이언트 |
| `frontend/src/` | React 애플리케이션 |
| `docs/` | 설계 문서 |

`docs/07-walkthrough.md`는 화면을 직접 조작하며 각 결정의 근거를 확인하는
순서를 담고 있다. 코드를 처음 읽는다면 여기서 시작하는 편이 빠르다.
