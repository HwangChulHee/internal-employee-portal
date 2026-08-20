"""사내 한글 성명 ↔ 외부 API 형식 변환.

순수 함수만 둔다. DB나 HTTP에 의존하지 않는다.

"이름 분리는 외부 경계에서만 일어난다"는 결정이 이 모듈의 위치로 표현된다.
내부 모델은 통이름 하나를 유지하고, 분리는 여기서만 수행한다.
"""

COMPOUND_SURNAMES = frozenset(
    {"남궁", "황보", "제갈", "선우", "독고", "사공", "서문", "동방"}
)


def is_ambiguous(name: str) -> bool:
    """복성 여부를 규칙만으로 판별할 수 없는 이름인가.

    앞 2글자가 복성 목록에 있고 길이가 3 이상이면 모호하다.
    예: "남궁민"은 성이 "남"일 수도 "남궁"일 수도 있다.
    """
    return len(name) >= 3 and name[:2] in COMPOUND_SURNAMES


def surname_candidates(name: str) -> list[str]:
    """모호한 이름의 성 후보. 짧은 것부터 반환한다."""
    if not is_ambiguous(name):
        return [name[:1]]
    return [name[:1], name[:2]]


def to_external_name(name: str, surname: str | None = None) -> tuple[str, str]:
    """사내 한글 성명을 외부 API 형식으로 변환한다.

    Returns:
        (first_name, last_name) — first가 이름, last가 성이다.

        한국 이름은 성이 앞에 오지만 영어권 API는 last가 성이므로 순서가 뒤집힌다.
        "김민준" -> ("민준", "김"). "앞 = first"가 아니다.

    Raises:
        ValueError: surname이 이름의 접두사가 아닐 때.
    """
    if surname:
        if not name.startswith(surname):
            raise ValueError("성은 이름의 앞부분과 일치해야 합니다")
    elif is_ambiguous(name):
        # 모호한 이름은 호출 전에 관리자가 확정해야 한다.
        # 여기까지 왔다면 서비스 계층이 모호성 검사를 빠뜨린 것이다.
        surname = name[:2]
    else:
        surname = name[:1]

    given = name[len(surname) :]
    return given, surname
