from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    login_id: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1)


class MessageResponse(BaseModel):
    message: str
