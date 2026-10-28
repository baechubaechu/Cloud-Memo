// 자동 저장: 제목·본문 디바운스 저장, 서버 병합 기준점(baseRef·lastSentRef), 서버에 닿지
// 못했을 때 기기 초안 보관과 재시도, 밀린 초안 올리기, 그림 레이어 저장. Workbench 에서 분리.
//
// 편집 중인 초안(draftTitleRef·draftContentRef)과 에디터는 session(./useEditorSession)이 들고
// 있고, 여기서는 ref 로 받아 읽는다. 저장 기준점 ref 들은 노트 열기·동기화도 고치므로 그대로 돌려준다.

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { NoteDetail } from "@/lib/api";
import { ApiError, api } from "@/lib/api";
import { offlineStore } from "@/lib/offlineStore";
import { overlaySignature } from "./workbenchHelpers";
import type { EditorSession } from "./useEditorSession";

type Options = {
  token: string;
  onUnauthorized: () => void;
  /** 링크 갱신 알림을 띄우는 api.patchNote 래퍼. */
  patchNote: typeof api.patchNote;
  handleApiError: (e: unknown) => void;
  reloadNotes: () => Promise<void>;
  /** 저장이 끝난 노트를 목록에 반영한다. */
  refreshListAfterSave: (updated: NoteDetail) => void;
  setOffline: (next: boolean) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setTitleWarning: Dispatch<SetStateAction<string | null>>;
  setCacheTick: Dispatch<SetStateAction<number>>;
  /** 열린 노트의 편집 상태. 제목 칸(titleInputRef)에 포커스가 있는 동안은 이름 변경(링크 갱신)을 확정하지 않는다. */
  session: EditorSession;
};

export function useAutosave(options: Options) {
  const {
    token,
    onUnauthorized,
    patchNote,
    handleApiError,
    reloadNotes,
    refreshListAfterSave,
    setOffline,
    setError,
    setTitleWarning,
    setCacheTick,
    session,
  } = options;
  const {
    setSaveState,
    activeNoteId,
    activeNote,
    activeNoteIdRef,
    setActiveNote,
    titleInputRef,
    draftTitleRef,
    draftContentRef,
    setTitle,
    syncDraftFromDom,
    replaceEditorDoc,
    overlayStrokes,
    overlayStrokesRef,
  } = session;

  const saveTimerRef = useRef<number | null>(null);
  const lastSentRef = useRef<{ title: string; content: string; overlayKey: string }>({
    title: "",
    content: "",
    overlayKey: "",
  });
  /**
   * 동기화 기준점: 마지막으로 서버와 일치했던 제목·본문과 그때의 revision.
   * 저장할 때 같이 보내고, 서버 revision 이 다르면 서버가 이걸 기준으로 병합한다.
   */
  const baseRef = useRef<{ revision: number; title: string; content: string }>({
    revision: 0,
    title: "",
    content: "",
  });
  /** 저장 요청을 한 번에 하나씩만 보낸다 (동시에 두 개가 나가면 서로를 병합 대상으로 본다). */
  const flushChainRef = useRef<Promise<unknown>>(Promise.resolve());
  /** 제목 칸에서 타이핑하는 동안 이름만 저장하고 링크 수정은 미뤄 둔 노트 (확정 대기). */
  const pendingLinkCommitRef = useRef<string | null>(null);
  /** 직전 저장이 서버에 닿지 못했지만 초안은 기기에 남아 있음 (노트 전환을 막지 않는다). */
  const draftKeptOnDeviceRef = useRef(false);
  /** 서버에 닿지 못했을 때 저장을 다시 시도하는 타이머. */
  const retryTimerRef = useRef<number | null>(null);
  const flushAutosaveRef = useRef<() => void>(() => {});
  // 그림 레이어 자동 저장 타이머 (본문/제목과 별개의 디바운스)
  const overlayTimerRef = useRef<number | null>(null);

  const flushDraftForNote = useCallback(
    (noteId: string, note: NoteDetail, opts?: { commit?: boolean }): Promise<boolean> => {
      const run = async (): Promise<boolean> => {
        if (!noteId || note.deleted_at) return true;
        syncDraftFromDom();
        const nextTitle = draftTitleRef.current;
        const nextContent = draftContentRef.current;
        // 제목 칸에서 타이핑하는 중이면 이름 변경을 아직 확정하지 않는다 (서버가 다른 노트의
        // 링크를 고치지 않고, 중복 이름도 자동으로 바꾸지 않는다). 칸을 벗어나거나 노트를
        // 전환할 때 확정한다.
        const commit = !!opts?.commit || document.activeElement !== titleInputRef.current;
        const linkCommitPending = commit && pendingLinkCommitRef.current === noteId;
        const sameTitle = nextTitle === lastSentRef.current.title;
        const sameBody = nextContent === lastSentRef.current.content;
        if (sameTitle && sameBody && !linkCommitPending) return true;

        draftKeptOnDeviceRef.current = false;
        const base = baseRef.current;
        // 보내기 전에 기기에 먼저 적어 둔다. 서버에 닿지 못한 채 탭을 닫아도 글이
        // 남고, 다음에 연결되면 pushPendingDrafts 가 올린다.
        const draftStored = await offlineStore.putDraft({
          noteId,
          title: nextTitle,
          content: nextContent,
          baseRevision: base.revision,
          baseTitle: base.title,
          baseContent: base.content,
          updatedAt: Date.now(),
        });

        try {
          setSaveState("saving");
          // 태그·폴더는 각자의 핸들러가 저장한다. 여기서 같이 보내면 타이머를 건
          // 시점의 옛 값으로 방금 바꾼 태그/폴더를 되돌려 버린다.
          const request = {
            content: nextContent,
            update_links: commit,
            base_revision: base.revision,
            base_title: base.title,
            base_content: base.content,
          };
          // sentTitle: 실제로 서버에 보낸 제목. 이름 중복(409)으로 거절되면 제목은 빼고
          // 본문만 다시 보낸다 — 제목 문제로 본문까지 저장되지 않는 일이 없게.
          let sentTitle: string | null = nextTitle;
          let updated: NoteDetail;
          try {
            updated = await patchNote(token, noteId, {
              ...request,
              title: nextTitle,
              resolve_title_conflict: commit,
            });
          } catch (e) {
            if (!(e instanceof ApiError) || e.status !== 409) throw e;
            setTitleWarning(e.message);
            sentTitle = null;
            updated = await patchNote(token, noteId, request);
          }
          if (commit) {
            if (pendingLinkCommitRef.current === noteId) pendingLinkCommitRef.current = null;
          } else if (sentTitle !== null && sentTitle.trim() !== base.title.trim()) {
            pendingLinkCommitRef.current = noteId;
          }
          refreshListAfterSave(updated);
          void offlineStore.putNote(updated).then(() => setCacheTick((t) => t + 1));
          // 응답이 오기 전에 다른 노트로 넘어갔으면 화면 상태는 건드리지 않는다.
          if (activeNoteIdRef.current !== noteId) {
            await offlineStore.deleteDraft(noteId);
            return true;
          }

          const merged = updated.content !== nextContent || (sentTitle !== null && updated.title !== sentTitle);
          if (
            nextTitle.trim() && updated.title !== nextTitle.trim() &&
            /^무제 노트(?: \d+)?$/.test(updated.title)
          ) {
            setTitleWarning(`같은 폴더에 '${nextTitle.trim()}' 이름의 노트가 이미 있어 '${updated.title}'로 변경했습니다.`);
          }
          const stillClean =
            draftTitleRef.current === nextTitle && draftContentRef.current === nextContent;
          if (!merged) {
            // 보낸 그대로 저장됨. (응답으로 화면을 덮어쓰지는 않는다 — 요청~응답
            // 사이에 입력한 글자가 되돌려지기 때문.) 제목이 거절됐으면 제목은 아직 미저장.
            lastSentRef.current = {
              ...lastSentRef.current,
              title: sentTitle ?? lastSentRef.current.title,
              content: nextContent,
            };
            baseRef.current = { revision: updated.revision, title: sentTitle ?? updated.title, content: nextContent };
          } else if (stillClean) {
            // 다른 기기의 변경과 병합됨 + 그 사이 추가 입력 없음 → 병합 결과를 화면에 반영.
            replaceEditorDoc(updated.content);
            draftTitleRef.current = updated.title;
            setTitle(updated.title);
            lastSentRef.current = { ...lastSentRef.current, title: updated.title, content: updated.content };
            baseRef.current = { revision: updated.revision, title: updated.title, content: updated.content };
          } else {
            // 병합됐는데 그 사이 더 입력함 → 화면은 그대로 두고 기준점을 "방금 보낸 것"
            // 으로 둔다. revision 은 일부러 낡은 값을 유지해서, 다음 저장 때 서버가
            // (방금 보낸 것 → 지금 화면) 변경분만 병합 결과 위에 얹게 한다.
            lastSentRef.current = {
              ...lastSentRef.current,
              title: sentTitle ?? lastSentRef.current.title,
              content: nextContent,
            };
            baseRef.current = { revision: base.revision, title: sentTitle ?? base.title, content: nextContent };
          }
          setActiveNote(updated);
          const allSaved =
            draftTitleRef.current === lastSentRef.current.title &&
            draftContentRef.current === lastSentRef.current.content;
          // 더 입력한 게 남아 있으면 기기 초안은 다음 저장이 덮어쓸 때까지 둔다.
          if (allSaved) await offlineStore.deleteDraft(noteId);
          setSaveState(allSaved ? "saved" : "dirty");
          return true;
        } catch (e) {
          if (e instanceof ApiError) {
            handleApiError(e);
            setSaveState("dirty");
            return false;
          }
          // 서버에 닿지 못함(오프라인·서버 꺼짐). 글은 기기에 보관돼 있으니 경고 대신
          // 상태만 바꾸고, 연결될 때까지 주기적으로 다시 시도한다.
          // 초안이 기기에 남는 것은 "이 기기에 노트 보관" 을 켠 경우뿐이다.
          draftKeptOnDeviceRef.current = draftStored && offlineStore.isActive();
          setOffline(true);
          setSaveState("offline");
          if (retryTimerRef.current === null) {
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null;
              flushAutosaveRef.current();
            }, 5000);
          }
          return false;
        }
      };
      const chained = flushChainRef.current.then(run, run);
      flushChainRef.current = chained;
      return chained;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleApiError, refreshListAfterSave, setOffline, token],
  );

  /**
   * 아직 서버에 안 간 그림 stroke 를 즉시 저장한다. 노트 전환 직전에 불러서
   * 700ms 디바운스 대기 중이던 그림이 사라지지 않게 한다.
   */
  const flushOverlayForNote = useCallback(
    async (noteId: string): Promise<boolean> => {
      const strokes = overlayStrokesRef.current;
      const sig = overlaySignature(strokes);
      if (sig === lastSentRef.current.overlayKey) return true;
      if (overlayTimerRef.current) {
        window.clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
      try {
        await patchNote(token, noteId, { overlay_strokes: strokes });
        lastSentRef.current = { ...lastSentRef.current, overlayKey: sig };
        return true;
      } catch (e) {
        // 오프라인에서는 그림을 보관하지 못한다(아직 미지원). 노트 전환은 막지 않는다.
        if (!(e instanceof ApiError)) return true;
        handleApiError(e);
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleApiError, token],
  );

  const flushAutosave = useCallback(
    async () => {
      if (!activeNoteId || !activeNote || activeNote.deleted_at) return;
      await flushDraftForNote(activeNoteId, activeNote);
    },
    [activeNote, activeNoteId, flushDraftForNote],
  );

  flushAutosaveRef.current = () => void flushAutosave();

  /**
   * 지난번에 서버에 올리지 못한 초안을 올린다 (앱 시작 시, 다시 온라인이 될 때).
   * 지금 열려 있는 노트는 일반 저장 흐름이 처리하므로 건너뛴다.
   */
  const pushPendingDrafts = useCallback(async () => {
    const drafts = await offlineStore.listDrafts();
    let pushed = false;
    for (const d of drafts) {
      if (d.noteId === activeNoteIdRef.current) continue;
      try {
        await patchNote(token, d.noteId, {
          title: d.title,
          content: d.content,
          base_revision: d.baseRevision,
          base_title: d.baseTitle,
          base_content: d.baseContent,
        });
        await offlineStore.deleteDraft(d.noteId);
        pushed = true;
      } catch (e) {
        if (!(e instanceof ApiError)) break; // 아직 오프라인 — 다음 기회에.
        if (e.status === 401) {
          onUnauthorized();
          break;
        }
        if (e.status === 404) {
          // 그 사이 다른 기기에서 지워진 노트. 쓴 글을 버리지 않고 새 노트로 살린다.
          try {
            await api.createNote(token, { title: `${d.title || "무제 노트"} (복구)`, content: d.content });
            await offlineStore.deleteDraft(d.noteId);
            pushed = true;
          } catch {
            /* 다음 기회에 다시 */
          }
        }
      }
    }
    if (pushed) void reloadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onUnauthorized, reloadNotes, token]);

  useEffect(() => {
    // 보관이 꺼진 기기라면 예전에 남은 사본(암호화 이전의 평문 포함)을 지운다.
    void offlineStore.purgeIfDisabled().catch((error) => setError(String(error)));
    // 브라우저가 디스크 부족 시 사본·초안을 지우지 않도록 요청해 둔다.
    void offlineStore.requestPersistence();
    void pushPendingDrafts();
    const onOnline = () => {
      void pushPendingDrafts();
      flushAutosaveRef.current();
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushPendingDrafts]);

  // 그림 레이어 stroke 가 바뀌면 디바운스 후 서버로 패치한다. 본문 자동 저장과
  // 분리해서 텍스트 편집과 그림이 서로의 디바운스를 깨지 않게 한다.
  useEffect(() => {
    if (!activeNoteId || !activeNote || activeNote.deleted_at) return;
    // 노트 전환 중(id 는 새 노트, strokes 는 아직 옛 노트 것)에는 저장하지 않는다.
    if (activeNote.id !== activeNoteId) return;
    const sig = overlaySignature(overlayStrokes);
    if (sig === lastSentRef.current.overlayKey) return;
    if (overlayTimerRef.current) window.clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = window.setTimeout(async () => {
      overlayTimerRef.current = null;
      try {
        const updated = await patchNote(token, activeNoteId, {
          overlay_strokes: overlayStrokes,
        });
        lastSentRef.current = {
          ...lastSentRef.current,
          overlayKey: overlaySignature(updated.overlay_strokes ?? []),
        };
        // overlay_strokes 만 갱신된 응답으로 activeNote 의 다른 필드를 덮어쓰면
        // 사용자가 그동안 입력한 title/content 가 사라질 수 있다. 메타만 갱신.
        setActiveNote((prev) =>
          prev
            ? { ...prev, overlay_strokes: updated.overlay_strokes, change_seq: updated.change_seq }
            : prev,
        );
      } catch (e) {
        if (e instanceof ApiError) handleApiError(e);
      }
    }, 700);
    return () => {
      if (overlayTimerRef.current) {
        window.clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayStrokes, activeNoteId, activeNote, token, handleApiError]);

  const scheduleAutosave = useCallback(() => {
    if (!activeNoteId || !activeNote || activeNote.deleted_at) return;
    setSaveState("dirty");
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    // 한글은 마지막 글자가 "조합 중" 인 채로 멈추므로(다음 키나 포커스 이동 전까지
    // compositionend 가 안 온다), 조합 중이라고 저장을 미루면 제목이 영영 저장되지
    // 않는다. 저장 응답이 입력칸을 덮어쓰지 않으므로 조합 중 저장해도 글자가 깨지지 않는다.
    saveTimerRef.current = window.setTimeout(() => {
      void flushAutosave();
      saveTimerRef.current = null;
    }, 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote, activeNoteId, flushAutosave]);

  return {
    saveTimerRef,
    lastSentRef,
    baseRef,
    draftKeptOnDeviceRef,
    flushAutosaveRef,
    flushDraftForNote,
    flushOverlayForNote,
    flushAutosave,
    pushPendingDrafts,
    scheduleAutosave,
  };
}
