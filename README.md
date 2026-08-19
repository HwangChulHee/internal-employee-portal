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
