import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import auth, background_checks, employees, me
from app.config import settings
from app.database import get_db
from app.external.deps import build_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """외부 API 클라이언트를 앱 수명 동안 재사용한다.

    요청마다 AsyncClient를 만들면 커넥션 풀의 이점이 사라진다.
    """
    app.state.check_client = build_client()
    if settings.USE_FAKE_API:
        logger.warning(
            "가짜 외부 API를 사용한다 (FAKE_MODE=%s). 실제 호출이 일어나지 않는다.",
            settings.FAKE_MODE,
        )
    yield
    await app.state.check_client.aclose()


app = FastAPI(title="Internal Employee Portal", lifespan=lifespan)

# allow_credentials=True일 때 allow_origins=["*"]는 동작하지 않으므로
# config에서 명시적인 origin 목록을 받는다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health(db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
    await db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}


app.include_router(auth.router)
app.include_router(me.router)
app.include_router(employees.router)
app.include_router(background_checks.employee_router)
app.include_router(background_checks.check_router)
