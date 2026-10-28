// 우측 "할 일" 패널: 모든 노트의 체크리스트 줄을 모아 보여주고, 패널에서 체크를 바꾸면
// 그 노트에 저장한다 (열린 노트면 에디터·저장 기준점도 같이 맞춘다). Workbench 에서 분리.

import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import { api } from "@/lib/api";
import { parseChecklistLine } from "./markdown";
import type { EditorSession } from "./useEditorSession";
import type { RightPanelKind } from "./WorkbenchRightPanel";
import { extractTodoItems } from "./workbenchHelpers";
import type { TodoPanelItem } from "./workbenchTypes";

type Options = {
  token: string;
  session: EditorSession;
  /** 패널을 "할 일"로 열 때 한 번 훑는다. */
  rightPanel: RightPanelKind | null;
  /** 링크 갱신 알림을 띄우는 api.patchNote 래퍼. */
  patchNote: typeof api.patchNote;
  lastSentRef: MutableRefObject<{ title: string; content: string; overlayKey: string }>;
  baseRef: MutableRefObject<{ revision: number; title: string; content: string }>;
  reloadNotes: () => Promise<void>;
  handleApiError: (e: unknown) => void;
};

export function useTodoPanel(options: Options) {
  const { token, session, rightPanel, patchNote, lastSentRef, baseRef, reloadNotes, handleApiError } = options;
  const { activeNoteId, activeNote, setActiveNote, content, draftTitleRef, replaceEditorDoc, setSaveState } = session;
  const [todoItems, setTodoItems] = useState<TodoPanelItem[]>([]);
  const [todoLoading, setTodoLoading] = useState(false);

  const refreshTodoItems = useCallback(async () => {
    if (!token) return;
    setTodoLoading(true);
    try {
      const rows = await api.listNotes(token, { archived: false, trash: false });
      const details = await Promise.all(rows.map((n) => api.getNote(token, n.id)));
      const items = details.flatMap((note) => {
        const sourceContent = activeNoteId === note.id ? content : note.content;
        const sourceTitle = activeNoteId === note.id ? draftTitleRef.current : note.title;
        return extractTodoItems({ id: note.id, title: sourceTitle }, sourceContent);
      });
      setTodoItems(items);
    } catch (e) {
      handleApiError(e);
    } finally {
      setTodoLoading(false);
    }
  }, [activeNoteId, content, handleApiError, token]);

  useEffect(() => {
    if (rightPanel !== "todos") return;
    void refreshTodoItems();
    // 우측 패널을 "할 일"로 열 때 전체 노트를 한 번 훑는다. content 변경마다
    // 전체 노트를 다시 가져오면 입력 중 과도한 API 호출이 생기므로 수동
    // 새로고침과 패널 내 토글로 갱신한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightPanel]);

  const toggleTodoFromPanel = useCallback(
    async (item: TodoPanelItem) => {
      try {
        const isActive = activeNoteId === item.noteId && !!activeNote;
        const note = isActive ? activeNote : await api.getNote(token, item.noteId);
        const sourceContent = isActive ? content : note.content;
        const lines = sourceContent.split("\n");
        const rawLine = lines[item.lineIndex] ?? "";
        const parsed = parseChecklistLine(rawLine);
        if (!parsed) {
          await refreshTodoItems();
          return;
        }
        const nextChar = parsed.checked ? " " : "x";
        lines[item.lineIndex] =
          rawLine.slice(0, parsed.stateOffset) + nextChar + rawLine.slice(parsed.stateOffset + 1);
        const nextContent = lines.join("\n");
        const nextTitle = isActive ? draftTitleRef.current : note.title;
        const base = isActive
          ? baseRef.current
          : { revision: note.revision, title: note.title, content: note.content };
        const updated = await patchNote(token, item.noteId, {
          content: nextContent,
          title: nextTitle,
          base_revision: base.revision,
          base_title: base.title,
          base_content: base.content,
        });
        if (isActive) {
          // 서버가 다른 기기의 변경과 병합했을 수 있으므로 응답 본문을 기준으로 맞춘다.
          replaceEditorDoc(updated.content);
          setActiveNote(updated);
          lastSentRef.current = {
            ...lastSentRef.current,
            title: nextTitle,
            content: updated.content,
          };
          baseRef.current = { revision: updated.revision, title: nextTitle, content: updated.content };
          setSaveState("saved");
        }
        setTodoItems((prev) =>
          prev.map((x) =>
            x.id === item.id
              ? {
                  ...x,
                  checked: !parsed.checked,
                }
              : x,
          ),
        );
        void reloadNotes();
      } catch (e) {
        handleApiError(e);
      }
    },
    [activeNote, activeNoteId, content, handleApiError, refreshTodoItems, reloadNotes, token],
  );

  return { todoItems, todoLoading, refreshTodoItems, toggleTodoFromPanel };
}
