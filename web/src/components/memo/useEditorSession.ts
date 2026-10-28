// 지금 열린 노트의 편집 상태: 노트, 제목·본문(state 와 동기 초안 ref), 저장 상태, 그림
// 레이어, 에디터 DOM ref. 자동 저장·동기화·백링크·사이드바 훅이 모두 같은 값을 읽고 고치므로
// 한 묶음(session)으로 넘긴다. Workbench 에서 분리.

import { useCallback, useEffect, useRef, useState } from "react";
import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { NoteDetail, OverlayStroke } from "@/lib/api";
import type { SaveState } from "./WorkbenchEditor";

export function useEditorSession() {
  const [activeNoteId, setActiveNoteId] = useState<string | undefined>(undefined);
  const [activeNote, setActiveNote] = useState<NoteDetail | undefined>(undefined);
  /** loadNote 가 오래된 closure 를 쓰지 않도록 — 노트 전환 직전 flush 에 최신 id/detail 필요 */
  const activeNoteIdRef = useRef<string | undefined>(undefined);
  const activeNoteRef = useRef<NoteDetail | undefined>(undefined);
  useEffect(() => {
    activeNoteIdRef.current = activeNoteId;
  }, [activeNoteId]);
  useEffect(() => {
    activeNoteRef.current = activeNote;
  }, [activeNote]);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  /** setState 직후 디바운스된 flushAutosave 가 옛 title/content 클로저를 읽는 것을 막기 위한 동기 초안 */
  const draftTitleRef = useRef("");
  const draftContentRef = useRef("");

  // 본문 위 자유 그림 레이어 상태. activeNote.overlay_strokes 와 양방향 동기.
  const [overlayStrokes, setOverlayStrokes] = useState<OverlayStroke[]>([]);
  const overlayStrokesRef = useRef(overlayStrokes);
  overlayStrokesRef.current = overlayStrokes;

  // 에디터 제목 input ref — 새 노트 직후 포커스
  const titleInputRef = useRef<HTMLInputElement>(null);
  // CodeMirror EditorView — onCreateEditor 에서 채워짐. 첨부 마커 삽입에 사용.
  const editorViewRef = useRef<EditorView | null>(null);
  // True while a Korean/Japanese/Chinese IME is composing a character.
  // We must not run the autosave debounce timer during composition,
  // otherwise React re-renders mid-composition and the in-progress jamo
  // (e.g. the last 한글 character) gets dropped.
  const composingRef = useRef(false);
  /** 원격 변경을 에디터에 넣는 중 — 이때의 onChange 는 사용자 입력이 아니므로 저장을 예약하지 않는다. */
  const applyingRemoteRef = useRef(false);

  /** 제목 input·CodeMirror 에만 있고 아직 ref/state 에 안 올라온 글자까지 플러시에 포함 */
  const syncDraftFromDom = useCallback((): void => {
    const titleEl = titleInputRef.current;
    if (titleEl) draftTitleRef.current = titleEl.value;
    const view = editorViewRef.current;
    if (view) draftContentRef.current = view.state.doc.toString();
  }, []);

  /**
   * 에디터 본문을 `next` 로 바꾼다. 앞뒤 공통 부분은 건드리지 않고 달라진 가운데만
   * 교체해서 캐럿·스크롤이 유지되게 하고, undo 히스토리에는 넣지 않는다
   * (Ctrl+Z 가 다른 기기의 수정을 되돌리면 안 된다).
   */
  const replaceEditorDoc = useCallback((next: string): void => {
    draftContentRef.current = next;
    const view = editorViewRef.current;
    if (view) {
      const cur = view.state.doc.toString();
      if (cur !== next) {
        const max = Math.min(cur.length, next.length);
        let start = 0;
        while (start < max && cur.charCodeAt(start) === next.charCodeAt(start)) start += 1;
        let end = 0;
        while (
          end < max - start &&
          cur.charCodeAt(cur.length - 1 - end) === next.charCodeAt(next.length - 1 - end)
        ) {
          end += 1;
        }
        applyingRemoteRef.current = true;
        try {
          view.dispatch({
            changes: { from: start, to: cur.length - end, insert: next.slice(start, next.length - end) },
            annotations: Transaction.addToHistory.of(false),
          });
        } finally {
          applyingRemoteRef.current = false;
        }
      }
    }
    setContent(next);
  }, []);

  return {
    activeNoteId,
    setActiveNoteId,
    activeNote,
    setActiveNote,
    activeNoteIdRef,
    activeNoteRef,
    title,
    setTitle,
    content,
    setContent,
    saveState,
    setSaveState,
    draftTitleRef,
    draftContentRef,
    overlayStrokes,
    setOverlayStrokes,
    overlayStrokesRef,
    titleInputRef,
    editorViewRef,
    composingRef,
    applyingRemoteRef,
    syncDraftFromDom,
    replaceEditorDoc,
  };
}

export type EditorSession = ReturnType<typeof useEditorSession>;
