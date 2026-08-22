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

    # pending 조회를 "진행 중"으로 인정하는 시간. 이 창을 넘긴 pending은
    # 중복 방지에서 제외되고 화면에 "응답 없음"으로 표시된다.
    # 실측 완료 시간(~10초)의 수백 배라, 진짜 진행 중인 조회를 오판할 일은
    # 사실상 없다. 창이 없으면 외부가 조회를 잃어버렸을 때(404 등) 완료될 수
    # 없는 pending이 그 직원의 신규 조회를 영원히 막는 교착이 된다.
    CHECK_IN_PROGRESS_WINDOW_SECONDS: int = 3600

    # 외부 API 연동 설정. 코드에 흩지 않고 여기에 모은다.
    EXTERNAL_TIMEOUT_SECONDS: float = 10.0
    EXTERNAL_MAX_RETRIES: int = 3
    EXTERNAL_BACKOFF_BASE_SECONDS: float = 1.0
    EXTERNAL_DEFAULT_RETRY_AFTER: int = 5
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]


settings = Settings()
