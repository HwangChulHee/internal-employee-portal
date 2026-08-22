"""목록 응답의 페이지 골격.

items의 타입이 목록마다 달라 제네릭으로 둔다.
total을 함께 내려보내는 이유: 프론트가 전체 페이지 수를 계산해
"n / m 페이지"를 그리려면 현재 페이지만으로는 알 수 없다.
"""

from pydantic import BaseModel


class PageMeta(BaseModel):
    total: int
    page: int
    page_size: int
