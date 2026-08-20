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

    # 외부 API 연동 설정. 코드에 흩지 않고 여기에 모은다.
    EXTERNAL_TIMEOUT_SECONDS: float = 10.0
    EXTERNAL_MAX_RETRIES: int = 3
    EXTERNAL_BACKOFF_BASE_SECONDS: float = 1.0
    EXTERNAL_DEFAULT_RETRY_AFTER: int = 5
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]


settings = Settings()
