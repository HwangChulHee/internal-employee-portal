from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import auth, employees, me
from app.config import settings
from app.database import get_db

app = FastAPI(title="Internal Employee Portal")

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
