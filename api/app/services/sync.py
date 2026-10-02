"""여러 기기 동기화 헬퍼.

방식은 Obsidian Sync 와 같다: 노트 단위로 저장하고, 클라이언트가 본 revision 이
서버와 다르면 diff-match-patch 로 3-way 병합한다. 다른 기기의 변경은 전역
카운터(seq) 기준 폴링으로 가져간다.
"""
from __future__ import annotations

from diff_match_patch import diff_match_patch
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import Note, NoteTombstone, SyncCounter


def next_seq(db: Session) -> int:
    """전역 카운터를 1 올리고 새 값을 돌려준다. 호출한 트랜잭션과 함께 커밋된다."""
    return int(
        db.execute(
            update(SyncCounter)
            .where(SyncCounter.id == 1)
            .values(seq=SyncCounter.seq + 1)
            .returning(SyncCounter.seq)
        ).scalar_one()
    )


def touch_note(db: Session, note: Note, *, text_changed: bool = False) -> None:
    """노트가 바뀌었음을 기록한다. 제목·본문이 바뀌었으면 revision 도 올린다."""
    note.change_seq = next_seq(db)
    if text_changed:
        note.revision = (note.revision or 1) + 1


def touch_meta(db: Session) -> None:
    """폴더·태그 구조가 바뀌었음을 기록한다."""
    seq = next_seq(db)
    db.execute(update(SyncCounter).where(SyncCounter.id == 1).values(meta_seq=seq))


def add_tombstone(db: Session, note: Note) -> None:
    db.add(NoteTombstone(note_id=note.id, user_id=note.user_id, seq=next_seq(db)))


def merge_text(base: str, theirs: str, mine: str) -> str:
    """3-way 병합: base→mine 변경분을 theirs 위에 적용한다.

    같은 위치를 양쪽에서 고친 경우 diff-match-patch 가 최선의 위치를 찾아
    적용하므로 중복 텍스트가 생길 수 있다 (호출부가 병합 전 스냅샷을 남긴다).
    """
    if mine == base:
        return theirs
    if theirs == base:
        return mine
    if mine == theirs:
        return mine
    dmp = diff_match_patch()
    patches = dmp.patch_make(base, mine)
    merged, _applied = dmp.patch_apply(patches, theirs)
    return merged
