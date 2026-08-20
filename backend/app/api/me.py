from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee
from app.database import get_db
from app.schemas.employee import MeResponse, MeUpdate
from app.services import employee_service

router = APIRouter(prefix="/api/me", tags=["me"])


@router.get("", response_model=MeResponse)
async def read_me(employee: CurrentEmployee) -> MeResponse:
    return MeResponse.model_validate(employee)


@router.patch("", response_model=MeResponse)
async def update_me(
    payload: MeUpdate,
    employee: CurrentEmployee,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MeResponse:
    updated = await employee_service.update_me(db, employee, payload)
    return MeResponse.model_validate(updated)
