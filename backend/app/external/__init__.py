"""외부 API와 닿는 코드를 모은다.

이름 변환이 여기 있는 것이 중요하다.
"이름 분리는 외부 경계에서만 일어난다"는 결정이 디렉토리 위치로 표현된다.
"""

from app.external.base import (
    BackgroundCheckClient,
    CheckCreated,
    CheckRequest,
    CheckResult,
    CheckSummary,
    ExternalApiError,
    ExternalBadRequest,
    ExternalNotFound,
    ExternalServerError,
    ExternalTimeout,
    ExternalUnavailable,
)

__all__ = [
    "BackgroundCheckClient",
    "CheckCreated",
    "CheckRequest",
    "CheckResult",
    "CheckSummary",
    "ExternalApiError",
    "ExternalBadRequest",
    "ExternalNotFound",
    "ExternalServerError",
    "ExternalTimeout",
    "ExternalUnavailable",
]
