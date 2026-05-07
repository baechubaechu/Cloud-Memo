"""검색 쿼리 파서.

`#태그` 토큰과 일반 텍스트를 분리한다. notes.list_notes 와 search.search 가
같은 동작을 공유하기 위해 한 곳에서 관리한다.
"""
from __future__ import annotations

import re

# `#` 뒤에 공백이나 또 다른 `#` 가 없는 1토큰 (한글/영문/숫자 모두 허용).
_TAG_TOKEN_RE = re.compile(r"#([^\s#]+)")


def split_query(raw: str) -> tuple[list[str], str]:
    """`raw` 입력을 (태그 토큰 목록, 텍스트 부분) 으로 나눈다.

    예) "#일기 #공부 React 메모" -> (["일기", "공부"], "React 메모")
    """
    tags = [t.strip() for t in _TAG_TOKEN_RE.findall(raw) if t.strip()]
    text_q = _TAG_TOKEN_RE.sub(" ", raw).strip()
    return tags, text_q
