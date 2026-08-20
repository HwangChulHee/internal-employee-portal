"""외부 클라이언트 주입.

FastAPI 의존성으로 제공해 테스트에서 dependency_overrides로 교체할 수 있게 한다.
"""

import httpx
from fastapi import Request

from app.config import settings
from app.external.base import BackgroundCheckClient
from app.external.fake_client import build_fake_client
from app.external.http_client import HttpClient


def build_client() -> BackgroundCheckClient:
    """설정에 따라 실제 클라이언트 또는 가짜 클라이언트를 만든다."""
    if settings.USE_FAKE_API:
        return build_fake_client(settings.FAKE_MODE)
    return HttpClient(
        httpx.AsyncClient(
            base_url=settings.BACKGROUND_CHECK_API_URL,
            timeout=settings.EXTERNAL_TIMEOUT_SECONDS,
        )
    )


def get_check_client(request: Request) -> BackgroundCheckClient:
    """lifespan에서 만들어 둔 클라이언트를 재사용한다.

    요청마다 AsyncClient를 만들면 커넥션 풀의 이점이 사라진다.
    """
    return request.app.state.check_client
