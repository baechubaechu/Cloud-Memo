// 동기화: 다른 기기의 변경을 몇 초 간격으로 가져오고, 기기 사본(오프라인용)을 최신으로
// 유지하고, 서버에 다시 닿으면 온라인 상태로 되돌린다. Workbench 에서 분리.
//
// 열린 노트의 편집 상태는 session(./useEditorSession), 저장 기준점은 ./useAutosave 가 들고
// 있고, 여기서는 ref 로 받아 읽고 고친다. 폴링 루프는 한 번만 만들고 처리 함수는 ref 로
// 최신 것을 읽는다.

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { NoteDetail, NoteListItem, SyncChanges } from "@/lib/api";
import { ApiError, api } from "@/lib/api";
import { offlineStore } from "@/lib/offlineStore";
import { overlaySignature } from "./workbenchHelpers";
import type { EditorSession } from "./useEditorSession";

type Options = {
  token: string;
  onUnauthorized: () => void;
  offlineRef: MutableRefObject<boolean>;
  setOffline: (next: boolean) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setCacheTick: Dispatch<SetStateAction<number>>;
  refreshMeta: () => Promise<void>;
  reloadNotes: () => Promise<void>;
  pushPendingDrafts: () => Promise<void>;
  flushAutosaveRef: MutableRefObject<() => void>;
  /** 열린 노트를 닫는다 (대기 중인 저장 취소 포함). */
  closeActiveNote: () => void;
  lastSentRef: MutableRefObject<{ title: string; content: string; overlayKey: string }>;
  baseRef: MutableRefObject<{ revision: number; title: string; content: string }>;
  session: EditorSession;
};

export function useNoteSync(options: Options) {
  const {
    token,
    onUnauthorized,
    offlineRef,
    setOffline,
    setError,
    setCacheTick,
    refreshMeta,
    reloadNotes,
    pushPendingDrafts,
    flushAutosaveRef,
    closeActiveNote,
    lastSentRef,
    baseRef,
    session,
  } = options;
  const {
    activeNoteIdRef,
    activeNoteRef,
    setActiveNote,
    draftTitleRef,
    draftContentRef,
    setTitle,
    overlayStrokesRef,
    setOverlayStrokes,
    composingRef,
    editorViewRef,
    syncDraftFromDom,
    replaceEditorDoc,
    setSaveState,
  } = session;

  /** 동기화 폴링 위치. null 이면 아직 첫 응답 전. */
  const syncSeqRef = useRef<number | null>(null);

  // ---------- 오프라인 사본: 모든 노트를 이 기기에 내려받아 둔다 ----------

  const cacheBusyRef = useRef(false);
  /**
   * 서버와 비교해 없는/낡은 노트 사본만 받아 온다. 처음엔 전체를 받고, 이후엔
   * 마지막으로 받은 위치(cacheSeq) 이후 바뀐 것만 받는다.
   */
  const refreshCache = useCallback(async () => {
    if (cacheBusyRef.current || !offlineStore.isActive()) return;
    cacheBusyRef.current = true;
    try {
      const since = await offlineStore.getKv<number>("cacheSeq");
      let nextSeq: number;
      let rows: NoteListItem[];
      if (since === undefined) {
        // 위치를 먼저 받고 목록을 읽는다 — 그 사이 변경은 다음 번에 다시 잡힌다.
        nextSeq = (await api.syncChanges(token)).seq;
        rows = [
          ...(await api.listNotes(token, { archived: false })),
          ...(await api.listNotes(token, { archived: true })),
        ];
      } else {
        const res = await api.syncChanges(token, since);
        nextSeq = res.seq;
        rows = res.notes;
        for (const id of res.deleted) await offlineStore.deleteNote(id);
      }
      // 버전 번호만 읽어 비교한다 (본문까지 읽으면 노트가 많을 때 매번 전체를 메모리에 올린다).
      const have = await offlineStore.noteSeqs();
      let changed = false;
      for (const row of rows) {
        if (have.get(row.id) === row.change_seq) continue;
        await offlineStore.putNote(await api.getNote(token, row.id));
        changed = true;
      }
      await offlineStore.setKv("cacheSeq", nextSeq);
      if (changed || since === undefined) setCacheTick((t) => t + 1);
    } catch {
      /* 오프라인이거나 중간에 끊김 — 받은 데까지만 두고 다음에 이어서 */
    } finally {
      cacheBusyRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ---------- 동기화: 다른 기기의 변경을 몇 초 간격으로 가져온다 ----------

  /** 다른 곳에서 바뀐 활성 노트를 화면에 반영한다. 편집 중인 본문은 건드리지 않는다. */
  function applyRemoteNote(fresh: NoteDetail): void {
    void offlineStore.putNote(fresh);
    setActiveNote(fresh);
    // 그림: 아직 저장 안 된 내 stroke 가 없을 때만 원격 것으로 교체.
    const remoteOverlay = Array.isArray(fresh.overlay_strokes) ? fresh.overlay_strokes : [];
    if (overlaySignature(overlayStrokesRef.current) === lastSentRef.current.overlayKey) {
      lastSentRef.current = { ...lastSentRef.current, overlayKey: overlaySignature(remoteOverlay) };
      setOverlayStrokes(remoteOverlay);
    }
    if (fresh.revision === baseRef.current.revision) return;
    syncDraftFromDom();
    const clean =
      draftTitleRef.current === lastSentRef.current.title &&
      draftContentRef.current === lastSentRef.current.content;
    const composing = composingRef.current || !!editorViewRef.current?.composing;
    // 편집 중이면 그대로 둔다 — 다음 저장 때 서버가 병합해서 돌려준다.
    if (!clean || composing) return;
    replaceEditorDoc(fresh.content);
    draftTitleRef.current = fresh.title;
    setTitle(fresh.title);
    lastSentRef.current = { ...lastSentRef.current, title: fresh.title, content: fresh.content };
    baseRef.current = { revision: fresh.revision, title: fresh.title, content: fresh.content };
    setSaveState("saved");
  }

  async function handleSyncChanges(res: SyncChanges): Promise<void> {
    const prevSeq = syncSeqRef.current;
    syncSeqRef.current = res.seq;
    if (prevSeq === null) {
      // 첫 응답은 현재 위치만 알려준다. 화면의 목록은 이 위치를 받기 전에 읽은
      // 것이라 그 사이 변경을 놓쳤을 수 있으므로 한 번 다시 읽는다.
      void refreshMeta();
      void reloadNotes();
      void refreshCache();
      return;
    }
    if (prevSeq === res.seq) return;
    void refreshCache();

    const activeId = activeNoteIdRef.current;
    if (activeId && res.deleted.includes(activeId)) {
      // 다른 기기에서 지운 노트를 보고 있었다 → 닫는다 (저장하면 404 가 된다).
      closeActiveNote();
    }
    const activeRow = activeId ? res.notes.find((n) => n.id === activeId) : undefined;
    // 내 저장도 seq 를 올리므로, 이미 응답으로 받은 change_seq 와 같으면 내 변경이다.
    const activeChangedElsewhere =
      !!activeRow && activeRow.change_seq !== activeNoteRef.current?.change_seq;
    const listChanged =
      res.meta_changed ||
      res.deleted.length > 0 ||
      activeChangedElsewhere ||
      res.notes.some((n) => n.id !== activeId);
    if (res.meta_changed) void refreshMeta();
    if (listChanged) void reloadNotes();
    if (activeChangedElsewhere && activeId) {
      const fresh = await api.getNote(token, activeId);
      if (activeNoteIdRef.current === activeId) applyRemoteNote(fresh);
    }
  }

  /** 서버에 다시 닿았을 때: 밀린 편집을 올리고 목록을 서버 기준으로 되돌린다. */
  function handleBackOnline(): void {
    setOffline(false);
    setError(null);
    void pushPendingDrafts();
    flushAutosaveRef.current();
    void refreshMeta();
    void reloadNotes();
  }
  const backOnlineRef = useRef(handleBackOnline);
  backOnlineRef.current = handleBackOnline;

  // 폴링 루프는 한 번만 만들고, 처리 함수는 ref 로 최신 클로저를 읽는다.
  const handleSyncChangesRef = useRef(handleSyncChanges);
  handleSyncChangesRef.current = handleSyncChanges;

  useEffect(() => {
    const INTERVAL_MS = 3000;
    let stopped = false;
    let timer: number | null = null;
    let running = false;
    const tick = async () => {
      if (stopped || running) return;
      running = true;
      try {
        // 탭이 가려져 있으면 쉬고, 다시 보이는 순간 visibilitychange 가 바로 깨운다.
        if (document.visibilityState === "visible") {
          const res = await api.syncChanges(token, syncSeqRef.current ?? undefined);
          if (stopped) return;
          if (offlineRef.current) backOnlineRef.current();
          await handleSyncChangesRef.current(res);
        }
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 401) onUnauthorized();
        } else {
          // 서버에 닿지 않음 → 오프라인 모드. 다음 주기에 다시 확인한다.
          setOffline(true);
        }
      } finally {
        running = false;
        if (!stopped) timer = window.setTimeout(tick, INTERVAL_MS);
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) window.clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onUnauthorized, setOffline, token]);
}
