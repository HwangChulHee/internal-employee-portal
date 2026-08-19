from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    DATABASE_URL: str
    SESSION_SECRET: str
    SESSION_MAX_AGE_SECONDS: int = 86400
    # 로컬은 HTTP라 secure=True를 켜면 쿠키가 전송되지 않는다. 배포 시에만 True.
    COOKIE_SECURE: bool = False
    BACKGROUND_CHECK_API_URL: str
    USE_FAKE_API: bool = False
    FAKE_MODE: str = "normal"
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]


settings = Settings()
