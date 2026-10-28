// 노트 열기: 다른 노트로 넘어가기 전 저장(flush), 서버나 기기 사본에서 읽기, 남은 초안
// 이어 보여주기, 새로 만든 노트를 바로 띄우고 제목 칸에 포커스 붙잡아 두기. Workbench 에서 분리.

import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import type { NoteDetail, NoteListItem } from "@/lib/api";
import { ApiError, api } from "@/lib/api";
import { offlineStore, type PendingDraft } from "@/lib/offlineStore";
import { resetLastDocCursor } from "./editor";
import type { EditorSession } from "./useEditorSession";
import { overlaySignature } from "./workbenchHelpers";

type Options = {
  token: string;
  session: EditorSession;
  // 자동 저장(./useAutosave) 쪽 — 전환 직전 저장과 기준점
  saveTimerRef: MutableRefObject<number | null>;
  lastSentRef: MutableRefObject<{ title: string; content: string; overlayKey: string }>;
  baseRef: MutableRefObject<{ revision: number; title: string; content: string }>;
  draftKeptOnDeviceRef: MutableRefObject<boolean>;
  flushAutosaveRef: MutableRefObject<() => void>;
  flushDraftForNote: (noteId: string, note: NoteDetail, opts?: { commit?: boolean }) => Promise<boolean>;
  flushOverlayForNote: (noteId: string) => Promise<boolean>;
  /** 목록에 있는 제목으로 제목 칸을 먼저 맞춘다 (읽어 오는 동안 옛 제목이 보이지 않게). */
  notesRef: MutableRefObject<NoteListItem[]>;
  reloadNotes: () => Promise<void>;
  offlineRef: MutableRefObject<boolean>;
  setOffline: (next: boolean) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  handleApiError: (e: unknown) => void;
  setDrawingMode: Dispatch<SetStateAction<boolean>>;
};

export function useNoteLoader(options: Options) {
  const {
    token,
    session,
    saveTimerRef,
    lastSentRef,
    baseRef,
    draftKeptOnDeviceRef,
    flushAutosaveRef,
    flushDraftForNote,
    flushOverlayForNote,
    notesRef,
    reloadNotes,
    offlineRef,
    setOffline,
    setError,
    handleApiError,
    setDrawingMode,
  } = options;
  const {
    activeNoteId,
    setActiveNoteId,
    activeNote,
    setActiveNote,
    activeNoteIdRef,
    activeNoteRef,
    setTitle,
    setContent,
    setSaveState,
    draftTitleRef,
    draftContentRef,
    setOverlayStrokes,
    titleInputRef,
    editorViewRef,
  } = session;

  /** create 직후 해당 노트가 마운트되면 제목으로 포커스 (useLayoutEffect에서 소비) */
  const pendingFocusNewNoteRef = useRef<string | null>(null);

  /**
   * 노트를 에디터에 띄우고 저장 기준점을 맞춘다. pending(기기에 남은 못 보낸 초안)이 있으면
   * 그 내용을 보여주고, 기준점은 초안이 만들어질 때의 서버 상태로 둔다 — 그 뒤 서버가
   * 바뀌었으면 저장 때 병합된다.
   */
  const showNote = useCallback((note: NoteDetail, pending?: PendingDraft): void => {
    const shownTitle = pending ? pending.title : note.title;
    const shownContent = pending ? pending.content : note.content;
    setActiveNote(note);
    draftTitleRef.current = shownTitle;
    draftContentRef.current = shownContent;
    setTitle(shownTitle);
    setContent(shownContent);
    const incomingOverlay = Array.isArray(note.overlay_strokes) ? note.overlay_strokes : [];
    setOverlayStrokes(incomingOverlay);
    // 다른 노트로 옮기면 그리기 모드는 해제 (실수로 새 노트에 그리는 것 방지).
    setDrawingMode(false);
    const base = pending
      ? { revision: pending.baseRevision, title: pending.baseTitle, content: pending.baseContent }
      : { revision: note.revision, title: note.title, content: note.content };
    lastSentRef.current = { title: base.title, content: base.content, overlayKey: overlaySignature(incomingOverlay) };
    baseRef.current = base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadNote = useCallback(
    async (id: string) => {
      try {
        setError(null);

        if (saveTimerRef.current) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }

        const prevId = activeNoteIdRef.current;
        const prevNote = activeNoteRef.current;
        if (prevId && prevNote && !prevNote.deleted_at) {
          const saved = await flushDraftForNote(prevId, prevNote, { commit: true });
          // 서버에 닿지 못했어도 초안이 기기에 남아 있으면 전환을 막지 않는다.
          if (!saved && !draftKeptOnDeviceRef.current) {
            if (offlineRef.current) {
              setError(
                "서버와 이 기기에 편집 내용을 저장하지 못했습니다. 저장되지 않은 내용이 사라지지 않도록 현재 노트에 머무릅니다. 연결과 기기 저장 공간을 확인해 주세요.",
              );
            }
            return;
          }
          if (!(await flushOverlayForNote(prevId))) return;
        }

        const stalePending = pendingFocusNewNoteRef.current;
        if (stalePending != null && stalePending !== id) {
          pendingFocusNewNoteRef.current = null;
        }

        setActiveNoteId(id);
        // 노트가 바뀌면 이전 노트에서 두었던 캐럿 위치는 의미가 없다. 사용자가
        // 새 노트 본문에 클릭하기 전까지는 "명시적 캐럿 없음" 상태로 둔다.
        // 이렇게 안 하면 새 노트로 간 직후 툴바/드롭/붙여넣기로 첨부할 때
        // 이전 노트의 오프셋이 새 노트에 적용돼서 예상치 못한 위치(또는 0)에
        // 박히는 사고가 난다.
        resetLastDocCursor();
        // getNote 완료 전까지 React title 이 전 노트(방금 flush 한 값 포함)로 남아
        // 제목 입력칸이 잠깐 잘못 보였다가 바뀌는 현상 방지 — 목록에 있는 제목으로 즉시 맞춤.
        const listHit = notesRef.current.find((n) => n.id === id);
        const optimisticTitle = listHit?.title ?? "";
        const prevTitle = draftTitleRef.current;
        draftTitleRef.current = optimisticTitle;
        setTitle(optimisticTitle);

        let note: NoteDetail;
        try {
          note = await api.getNote(token, id);
          void offlineStore.putNote(note);
        } catch (e) {
          if (e instanceof ApiError) throw e;
          // 오프라인: 기기에 내려받은 사본으로 연다.
          setOffline(true);
          const cached = await offlineStore.getNote(id);
          if (!cached) {
            setActiveNoteId(prevId);
            draftTitleRef.current = prevTitle;
            setTitle(prevTitle);
            setError("이 노트는 아직 이 기기에 내려받지 못해 오프라인에서 열 수 없습니다.");
            return;
          }
          note = cached;
        }
        // 서버에 못 보낸 편집이 기기에 남아 있으면 그 내용을 이어서 보여준다.
        const pending = await offlineStore.getDraft(id);
        showNote(note, pending);
        if (pending) {
          setSaveState(offlineRef.current ? "offline" : "dirty");
          // activeNote 가 반영된 다음 렌더의 저장 함수로 올린다.
          window.setTimeout(() => flushAutosaveRef.current(), 100);
        } else {
          setSaveState("saved");
        }
      } catch (e) {
        handleApiError(e);
      }
    },
    [flushDraftForNote, flushOverlayForNote, handleApiError, setOffline, token],
  );

  /**
   * 새 노트를 만들고 받은 NoteDetail 을 그대로 활성화한다. loadNote 와 달리
   * api.getNote 를 다시 부르지 않아 await 사이의 렌더 사이클을 줄이고,
   * 그 직후 armTitleFocusGuard 로 제목에 포커스를 강제로 머무르게 한다.
   */
  async function activateFreshDraft(draft: NoteDetail): Promise<void> {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const prevId = activeNoteIdRef.current;
    const prevNote = activeNoteRef.current;
    if (prevId && prevId !== draft.id && prevNote && !prevNote.deleted_at) {
      const saved = await flushDraftForNote(prevId, prevNote, { commit: true });
      if (!saved) return;
      if (!(await flushOverlayForNote(prevId))) return;
    }

    pendingFocusNewNoteRef.current = draft.id;

    flushSync(() => {
      resetLastDocCursor();
      setActiveNoteId(draft.id);
      showNote(draft);
      setSaveState("saved");
    });

    void reloadNotes();
  }

  /**
   * 새 노트 직후 일정 시간 동안 제목 input 으로 포커스를 강제로 잡아둔다.
   * - CodeMirror 가 마운트되며 본문에 focus 가 들어가는 시점을 capture focusin 으로 즉시 가로채 제목으로 되돌린다.
   * - 약 700ms 간 짧은 간격으로 재시도해서 어떤 비동기 effect 뒤에도 안정적으로 제목에 머문다.
   */
  const armTitleFocusGuardRef = useRef<{ noteId: string; dispose: () => void } | null>(null);
  const armTitleFocusGuard = useCallback((noteId: string) => {
    armTitleFocusGuardRef.current?.dispose();
    pendingFocusNewNoteRef.current = noteId;

    const focusTitle = (): boolean => {
      const el = titleInputRef.current;
      if (!el) return false;
      if (document.activeElement !== el) {
        try {
          el.focus({ preventScroll: true });
        } catch {
          /* noop */
        }
      }
      try {
        el.setSelectionRange(0, el.value.length);
      } catch {
        try {
          el.select();
        } catch {
          /* noop */
        }
      }
      return document.activeElement === el;
    };

    focusTitle();

    const onFocusIn = (ev: FocusEvent) => {
      if (pendingFocusNewNoteRef.current !== noteId) return;
      const titleEl = titleInputRef.current;
      if (!titleEl) return;
      const target = ev.target as Node | null;
      if (target === titleEl) return;
      window.setTimeout(focusTitle, 0);
    };
    document.addEventListener("focusin", onFocusIn, true);
    // 사용자가 직접 클릭하거나 키를 누르면 가드를 즉시 푼다. 안 풀면 새 노트를 만든
    // 직후 본문을 클릭해도 포커스가 제목으로 끌려가 캐럿이 사라진다.
    const onUserIntent = () => armTitleFocusGuardRef.current?.dispose();
    document.addEventListener("pointerdown", onUserIntent, true);
    document.addEventListener("keydown", onUserIntent, true);

    const timers: number[] = [];
    [0, 16, 32, 64, 100, 160, 240, 360, 520, 750, 1100, 1600, 2200].forEach((ms) => {
      timers.push(window.setTimeout(focusTitle, ms));
    });
    const raf = window.requestAnimationFrame(focusTitle);

    const expire = window.setTimeout(() => {
      armTitleFocusGuardRef.current?.dispose();
    }, 2600);

    const dispose = () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("pointerdown", onUserIntent, true);
      document.removeEventListener("keydown", onUserIntent, true);
      timers.forEach((t) => window.clearTimeout(t));
      window.cancelAnimationFrame(raf);
      window.clearTimeout(expire);
      if (pendingFocusNewNoteRef.current === noteId) {
        pendingFocusNewNoteRef.current = null;
      }
      if (armTitleFocusGuardRef.current?.noteId === noteId) {
        armTitleFocusGuardRef.current = null;
      }
    };
    armTitleFocusGuardRef.current = { noteId, dispose };
  }, []);

  // 새 노트 activeNote 반영 직후·자식(CodeMirror) 레이아웃까지 끝난 뒤에만 가드를 건다.
  // flushSync 전에 arm 을 걸면 titleInputRef 가 아직 없어 포커스가 전부 스킵된다.
  useLayoutEffect(() => {
    const pending = pendingFocusNewNoteRef.current;
    if (!pending || pending !== activeNoteId || !activeNote || activeNote.id !== pending || activeNote.deleted_at) {
      return;
    }
    const view = editorViewRef.current;
    const ae = document.activeElement;
    if (view && ae instanceof HTMLElement && view.dom.contains(ae)) {
      ae.blur();
    }
    armTitleFocusGuard(pending);
  }, [activeNoteId, activeNote?.id, armTitleFocusGuard]);

  useEffect(() => {
    return () => {
      armTitleFocusGuardRef.current?.dispose();
    };
  }, []);

  return { loadNote, activateFreshDraft };
}
