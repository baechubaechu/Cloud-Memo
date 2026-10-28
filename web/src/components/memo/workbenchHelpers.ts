// Workbench 안에서 쓰던 순수 함수들. 외부 상태 / hook / DOM 의존이 없는 것만
// 이쪽으로 옮겨서 MemoWorkbench 본체의 줄 수를 줄인다.

import { parseChecklistLine } from "./markdown";
import type { NoteDetail, NoteListItem, OverlayStroke } from "@/lib/api";
import type { ListMode, TodoPanelItem } from "./workbenchTypes";

/**
 * 그림 레이어 stroke 배열이 변했는지 가볍게 비교하기 위한 시그니처.
 * 길이 + 마지막 stroke id + 마지막 점 개수만 보면 일반 편집 흐름에서 충돌은
 * 없다. (서버 응답이 들어와도 동일 길이 + 동일 last id 면 같다고 본다.)
 */
export function overlaySignature(strokes: OverlayStroke[]): string {
  if (!strokes || strokes.length === 0) return "0:";
  const last = strokes[strokes.length - 1];
  return `${strokes.length}:${last?.id ?? ""}:${last?.points?.length ?? 0}`;
}

/** 새 노트를 만들 때 API 에 넣는 기본 제목(빈 제목 대신). 사이드바 표시 문구와 맞춘다. */
export const DEFAULT_NEW_NOTE_TITLE = "무제 노트";

/** 오늘 날짜를 `YYYY-MM-DD` 형식으로 돌려준다. 데일리 노트 제목용. */
export function todayNoteTitle(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 노트 한 개의 본문에서 체크리스트 줄들을 뽑아 우측 "할 일" 패널이 보여줄
 * 항목 배열로 변환한다. 빈 텍스트는 placeholder 로 대체.
 */
export function extractTodoItems(
  note: { id: string; title: string },
  content: string,
): TodoPanelItem[] {
  return content.split("\n").flatMap((line, index) => {
    const item = parseChecklistLine(line);
    if (!item) return [];
    return [
      {
        id: `${note.id}:${index}`,
        noteId: note.id,
        noteTitle: note.title || "제목 없음",
        lineIndex: index,
        checked: item.checked,
        text: item.text.trim() || "(빈 할 일)",
      },
    ];
  });
}

/**
 * 오프라인일 때 기기에 내려받은 사본으로 사이드바 목록을 만든다. 온라인의 reloadNotes 와
 * 같은 규칙: 검색어가 있으면 폴더와 상관없이 찾고, 트리 모드(전체 + 태그 미선택)면 폴더별로
 * 거르지 않는다.
 */
export function buildOfflineNoteList(
  cached: NoteDetail[],
  opts: { mode: ListMode; query: string; selectedTagId: string | undefined; selectedFolderId: string | undefined },
): NoteListItem[] {
  const { mode, selectedTagId, selectedFolderId } = opts;
  const q = opts.query.trim().toLowerCase();
  const useTreeMode = mode === "active" && !selectedTagId;
  return cached
    .filter((n) => !n.deleted_at)
    .filter((n) => (mode === "archive" ? n.is_archived : !n.is_archived))
    .filter((n) => mode !== "favorite" || n.is_favorite)
    .filter((n) => !selectedTagId || n.tags.some((t) => t.id === selectedTagId))
    .filter((n) => q || useTreeMode || !selectedFolderId || n.folder_id === selectedFolderId)
    .filter(
      (n) =>
        !q ||
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.tags.some((t) => `#${t.name.toLowerCase()}`.includes(q)),
    )
    .map((n) => ({
      id: n.id,
      title: n.title,
      folder_id: n.folder_id,
      is_favorite: n.is_favorite,
      is_archived: n.is_archived,
      created_at: n.created_at,
      updated_at: n.updated_at,
      deleted_at: n.deleted_at,
      tags: n.tags,
      revision: n.revision,
      change_seq: n.change_seq,
    }));
}
