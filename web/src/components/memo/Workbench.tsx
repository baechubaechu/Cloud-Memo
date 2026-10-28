"use client";

import { useRouter } from "next/navigation";
import { REASON_LABEL, compareName } from "./utils";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import type {
  Folder,
  ListNotesQuery,
  NoteDetail,
  NoteListItem,
  NoteVersion,
  StorageUsage,
  Tag,
  TemplateSettings,
} from "@/lib/api";
import { ApiError, api } from "@/lib/api";
import { offlineStore } from "@/lib/offlineStore";
import { type OverlayDrawingLayerHandle, type OverlayDrawingTool } from "./OverlayDrawingLayer";
import type {
  ConfirmDialogState,
  HoverMeta,
  ListMode,
} from "./workbenchTypes";
import { todayNoteTitle, buildOfflineNoteList } from "./workbenchHelpers";
import { CommandPalette } from "./CommandPalette";
import { ConfirmDialog, ContextMenu, HoverTooltip, StatusBanners } from "./WorkbenchOverlays";
import { WorkbenchRibbon } from "./WorkbenchRibbon";
import { WorkbenchSidebar } from "./WorkbenchSidebar";
import { WorkbenchRightPanel } from "./WorkbenchRightPanel";
import { WorkbenchEditorCard } from "./WorkbenchEditor";
import { buildAppCommands } from "./workbenchCommands";
import { TemplateManager } from "./TemplateManager";
import { useAttachments } from "./useAttachments";
import { insertTextAtCursor } from "./editorInsert";
import { useSlashMenu } from "./useSlashMenu";
import { useBacklinks } from "./useBacklinks";
import { useNoteSync } from "./useNoteSync";
import { useAutosave } from "./useAutosave";
import { useSidebarTree } from "./useSidebarTree";
import { useEditorSession } from "./useEditorSession";
import { useNoteLoader } from "./useNoteLoader";
import { useTodoPanel } from "./useTodoPanel";
import { useCommandPalette } from "./useCommandPalette";
import { useTemplates } from "./useTemplates";
import { useEditorExtensions } from "./useEditorExtensions";
import { useStableHandlers } from "./useStableHandlers";
import { buildLinkCandidates, type LinkNote } from "./wikilinkPaths";

export function MemoWorkbench({
  token,
  onUnauthorized,
}: {
  token: string;
  onUnauthorized: () => void;
}) {
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [titleWarning, setTitleWarning] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<{ count: number } | null>(null);
  const patchNote = useCallback(async (...args: Parameters<typeof api.patchNote>) => {
    const updated = await api.patchNote(...args);
    if (updated.updated_link_note_count != null) {
      setLinkNotice({ count: updated.updated_link_note_count });
    }
    return updated;
  }, []);
  const patchFolder = useCallback(async (...args: Parameters<typeof api.patchFolder>) => {
    const updated = await api.patchFolder(...args);
    if (updated.updated_link_note_count != null) {
      setLinkNotice({ count: updated.updated_link_note_count });
    }
    return updated;
  }, []);
  useEffect(() => {
    if (!linkNotice) return;
    const timer = window.setTimeout(() => setLinkNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [linkNotice]);
  // 서버에 닿지 않는 동안 true. 이때는 기기에 내려받은 사본으로 동작한다.
  const [offline, setOfflineState] = useState(false);
  const offlineRef = useRef(false);
  const setOffline = useCallback((next: boolean) => {
    offlineRef.current = next;
    setOfflineState(next);
  }, []);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [linkNotes, setLinkNotes] = useState<LinkNote[]>([]);
  const [templateSettings, setTemplateSettings] = useState<TemplateSettings>({ templates: [] });
  const [templateDialog, setTemplateDialog] = useState<boolean | null>(null);
  const linkCandidates = useMemo(() => buildLinkCandidates(linkNotes, folders), [linkNotes, folders]);
  // 확장(위키링크 자동완성)·백링크처럼 목록이 바뀔 때마다 다시 만들면 안 되는 곳은 ref 로 읽는다.
  const linkCandidatesRef = useRef(linkCandidates);
  linkCandidatesRef.current = linkCandidates;
  const notesRef = useRef(notes);

  const [mode, setMode] = useState<ListMode>("active");
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(undefined);
  const [selectedTagId, setSelectedTagId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // 지금 열린 노트의 편집 상태 (./useEditorSession) — 아래 훅들에 session 으로 함께 넘긴다.
  const session = useEditorSession();
  const {
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
    replaceEditorDoc,
  } = session;
  useEffect(() => setTitleWarning(null), [activeNoteId]);
  const [versions, setVersions] = useState<NoteVersion[]>([]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  // 데스크탑 우측 토글 패널: 평소엔 닫혀있고 버튼으로 파일/버전/할 일 중 하나 표시
  const [rightPanel, setRightPanel] = useState<"files" | "versions" | "todos" | "backlinks" | null>(null);
  // 기기 사본이 바뀔 때마다 +1. 사본에서 계산하는 패널(백링크)이 다시 계산하는 신호.
  const [cacheTick, setCacheTick] = useState(0);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);
  // HoverMeta 타입은 ./workbenchTypes 로 이동.
  const [hoverMeta, setHoverMeta] = useState<HoverMeta | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [drawingMode, setDrawingMode] = useState(false);
  const [drawingTool, setDrawingTool] = useState<OverlayDrawingTool>("pen");
  const [drawingColor, setDrawingColor] = useState("#1f2937");
  const [drawingWidth, setDrawingWidth] = useState(2.5);
  const overlayHandleRef = useRef<OverlayDrawingLayerHandle | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const palette = useCommandPalette({ suspended: !!templateDialog || !!confirmDialog });
  // 위키링크 자동완성은 ./wikilinkExtension 의 CodeMirror autocomplete 확장이
  // 직접 들고 있다. 메뉴 상태 / 키보드 선택 / DOM 좌표 추적 모두 CodeMirror 가
  // 관리하므로 React state 는 두지 않는다.

  const handleApiError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorized();
      } else if (e instanceof ApiError) {
        setError(String(e.message ?? e.payload ?? "요청 오류"));
      } else {
        // fetch 자체가 실패 = 서버에 닿지 않음.
        setOffline(true);
        setError(
          "서버에 연결할 수 없습니다. 오프라인에서는 내려받아 둔 노트를 열고 고치는 것만 됩니다 (새 노트·삭제·폴더 변경은 연결 후에).",
        );
      }
    },
    [onUnauthorized, setOffline],
  );

  const refreshMeta = useCallback(async () => {
    try {
      setError(null);
      const [folderRows, tagRows, templates] = await Promise.all([api.listFolders(token), api.listTags(token), api.listTemplates(token)]);
      const liveFolders = folderRows.filter((f) => !f.deleted_at);
      const liveTags = tagRows.filter((t) => !t.deleted_at);
      setFolders(liveFolders);
      setTags(liveTags);
      setTemplateSettings(templates);
      void offlineStore.setKv("templates", templates);
      void offlineStore.setKv("folders", liveFolders);
      void offlineStore.setKv("tags", liveTags);
    } catch (e) {
      if (e instanceof ApiError) {
        handleApiError(e);
        return;
      }
      // 오프라인: 지난번에 받아 둔 폴더·태그를 쓴다.
      setOffline(true);
      setFolders((await offlineStore.getKv<Folder[]>("folders")) ?? []);
      setTags((await offlineStore.getKv<Tag[]>("tags")) ?? []);
      setTemplateSettings((await offlineStore.getKv<TemplateSettings>("templates")) ?? { templates: [] });
    }
  }, [handleApiError, setOffline, token]);

  const refreshUsage = useCallback(async () => {
    try {
      const u = await api.storageUsage(token);
      setUsage(u);
    } catch {
      /* non-critical */
    }
  }, [token]);

  const askConfirm = useCallback(
    (opts: { title: string; message: string; confirmLabel?: string }) =>
      new Promise<boolean>((resolve) => {
        confirmResolverRef.current = resolve;
        setConfirmDialog({
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel ?? "삭제",
        });
      }),
    [],
  );

  const closeConfirm = useCallback((ok: boolean) => {
    const done = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog(null);
    done?.(ok);
  }, []);

  const clearHoverMeta = useCallback(() => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverMeta(null);
  }, []);

  const scheduleHoverMeta = useCallback(
    (meta: Omit<HoverMeta, "x" | "y">, x: number, y: number) => {
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = window.setTimeout(() => {
        setHoverMeta({ ...meta, x, y });
      }, 1000);
    },
    [],
  );

  const reloadNotes = useCallback(async () => {
    try {
      setError(null);
      const [live, archived] = await Promise.all([
        api.listNotes(token, { archived: false }), api.listNotes(token, { archived: true }),
      ]);
      setLinkNotes([...live, ...archived]);
      const q = debouncedQuery.trim();
      if (q.length >= 1) {
        const rows = await api.searchNotes(token, q, {
          trash: false,
          archived: mode === "archive" ? true : false,
        });
        setNotes(rows);
        return;
      }
      // 트리 모드(active + 검색 없음 + 태그 미선택)에서는 폴더별 필터를 걸지 않고
      // 모든 노트를 한 번에 가져온다. 그래야 트리에서 여러 폴더를 동시에 펼쳐도
      // 각 폴더 안의 노트가 모두 표시된다 (한 폴더만 보이는 현상 방지).
      const useTreeMode = mode === "active" && !selectedTagId;
      const params: ListNotesQuery = {
        folderId: useTreeMode ? undefined : selectedFolderId,
        tagId: selectedTagId,
        trash: false,
        favorite: mode === "favorite" || undefined,
        archived: mode === "archive" ? true : false,
      };
      const rows = useTreeMode ? live : await api.listNotes(token, params);
      setNotes(rows);
    } catch (e) {
      if (e instanceof ApiError) {
        handleApiError(e);
        return;
      }
      // 오프라인: 기기에 내려받은 사본으로 같은 목록을 만든다.
      setOffline(true);
      const cached = await offlineStore.listNotes();
      setLinkNotes(cached.filter((note) => !note.deleted_at));
      setNotes(buildOfflineNoteList(cached, { mode, query: debouncedQuery, selectedTagId, selectedFolderId }));
    }
  }, [debouncedQuery, handleApiError, mode, selectedFolderId, selectedTagId, setOffline, token]);

  /**
   * 저장 응답으로 목록의 그 노트 한 줄만 고친다 (저장마다 목록 전체를 다시 받지 않게).
   * 검색 중이면 고친 본문이 검색 결과를 바꿀 수 있으니 다시 읽는다.
   */
  const refreshListAfterSave = useCallback(
    (updated: NoteDetail) => {
      if (debouncedQuery.trim()) {
        void reloadNotes();
        return;
      }
      setError(null);
      setNotes((prev) =>
        prev.map((n) =>
          n.id === updated.id
            ? {
                ...n,
                title: updated.title,
                folder_id: updated.folder_id,
                updated_at: updated.updated_at,
                revision: updated.revision,
                change_seq: updated.change_seq,
              }
            : n,
        ),
      );
      setLinkNotes((prev) =>
        prev.map((n) => (n.id === updated.id ? { ...n, title: updated.title, folder_id: updated.folder_id } : n)),
      );
    },
    [debouncedQuery, reloadNotes],
  );

  useEffect(() => {
    void refreshMeta();
    void refreshUsage();
  }, [refreshMeta, refreshUsage]);

  // 미디어 paste / drop / dragover 는 editor.ts 의
  // editorMediaInputHandlers (CodeMirror 확장) 에서 처리한다. 이전에 view.dom 에
  // 직접 listener 를 달았더니 CodeMirror 의 default paste/drop 이 먼저 텍스트로
  // 가로채는 케이스가 있어, 확장으로 옮겨 default 보다 먼저 실행되게 했다.

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 350);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
      if (confirmResolverRef.current) {
        const done = confirmResolverRef.current;
        confirmResolverRef.current = null;
        done(false);
      }
    };
  }, []);

  useEffect(() => {
    void reloadNotes();
  }, [reloadNotes]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  // ---------- 자동 저장 ----------
  const {
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
  } = useAutosave({
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
  });

  /** 열린 노트를 닫는다 (지워졌을 때). 대기 중인 저장도 취소한다 — 지운 노트에 저장하면 404. */
  function closeActiveNote(): void {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setActiveNoteId(undefined);
    setActiveNote(undefined);
    draftTitleRef.current = "";
    draftContentRef.current = "";
    setTitle("");
    setContent("");
  }

  // 편집 중인 제목은 IME 조합 때문에 서버 반영·reloadNotes 가 늦을 수 있다.
  // 사이드바/모바일 목록은 에디터의 title state 와 동기된 표시를 위해 활성 노트만 병합한다.
  const notesWithLiveTitle = useMemo(() => {
    if (!activeNoteId) return notes;
    return notes.map((n) => (n.id === activeNoteId ? { ...n, title } : n));
  }, [notes, activeNoteId, title]);

  // ---------- 사이드바 트리 ----------
  const {
    expandedFolders,
    setExpandedFolders,
    contextMenu,
    setContextMenu,
    renaming,
    setRenaming,
    creatingFolder,
    setCreatingFolder,
    draggedItem,
    setDraggedItem,
    draggedItemRef,
    folderDropHoverId,
    setFolderDropHoverId,
    rootDropActive,
    setRootDropActive,
    selectedNoteIds,
    folderOptions,
    allFoldersExpanded,
    toggleExpandAllFolders,
    beginCreateFolder,
    cancelCreateFolder,
    commitCreateFolder,
    toggleFolderExpanded,
    beginRename,
    cancelRename,
    commitRename,
    handleNoteContextDelete,
    handleDeleteFolder,
    childrenOf,
    notesInFolder,
    handleSelectNote,
    canDropIntoFolder,
    dropOnto,
    deleteNoteWithConfirm,
    expandFolder,
  } = useSidebarTree({
    token,
    folders,
    notes,
    notesWithLiveTitle,
    patchNote,
    patchFolder,
    refreshMeta,
    reloadNotes,
    refreshUsage,
    askConfirm,
    handleApiError,
    setError,
    setTitleWarning,
    session,
    closeActiveNote,
    selectedFolderId,
    setSelectedFolderId,
    suspended: !!templateDialog || !!confirmDialog,
  });

  // ---------- 노트 열기 ----------
  const { loadNote, activateFreshDraft } = useNoteLoader({
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
  });

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  // ---------- 할 일 패널 ----------
  const { todoItems, todoLoading, refreshTodoItems, toggleTodoFromPanel } = useTodoPanel({
    token,
    session,
    rightPanel,
    patchNote,
    lastSentRef,
    baseRef,
    reloadNotes,
    handleApiError,
  });

  // 버전 목록은 버전 패널이 열려 있을 때만 받는다. 저장·복원으로 revision 이 바뀌면 다시 받는다.
  useEffect(() => {
    if (rightPanel !== "versions" || !activeNoteId) return;
    let cancelled = false;
    api
      .listVersions(token, activeNoteId)
      .then((rows) => {
        if (!cancelled) setVersions(rows);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError) handleApiError(e);
        else setVersions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rightPanel, activeNoteId, activeNote?.revision, token, handleApiError]);

  // ---------- 백링크 ----------
  const { backlinks, brokenLinks, backlinksLoading, refreshBacklinks } = useBacklinks({
    token,
    folders,
    linkCandidatesRef,
    rightPanel,
    session,
    cacheTick,
    handleApiError,
  });

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const handleTitleCompositionEnd = useCallback(
    (ev: React.CompositionEvent<HTMLInputElement>) => {
      composingRef.current = false;
      const v = ev.currentTarget.value;
      draftTitleRef.current = v;
      setTitle(v);
      scheduleAutosave();
    },
    [scheduleAutosave],
  );

  const activeSearchTagToken = useMemo(() => {
    const m = query.match(/(?:^|\s)#([^\s#]*)$/);
    return m ? m[1] : null;
  }, [query]);
  const tagAutocomplete = useMemo(() => {
    if (activeSearchTagToken == null) return [];
    const needle = activeSearchTagToken.trim().toLowerCase();
    return tags
      .filter((t) => t.name.toLowerCase().includes(needle))
      .slice()
      .sort((a, b) => compareName(a.name, b.name))
      .slice(0, 8);
  }, [activeSearchTagToken, tags]);
  const applyTagAutocomplete = useCallback((tagName: string) => {
    setQuery((prev) =>
      prev.replace(/(?:^|\s)#[^\s#]*$/, (m) => `${m.startsWith(" ") ? " " : ""}#${tagName} `),
    );
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  const onLogout = async () => {
    // 삭제 실패를 완료로 표시하지 않고, 다른 탭을 닫은 뒤 다시 시도할 수 있게 한다.
    try {
      await offlineStore.setKeepOnDevice(false);
    } catch (error) {
      setError(String(error));
      return;
    }
    try {
      await api.logout(token);
    } catch {
      /* ignore */
    }
    try {
      // 개발 모드의 자동 로그인이 곧바로 다시 들어오지 않게 한다 (직접 로그아웃한 경우).
      window.sessionStorage.setItem("cloud_memo_skip_autologin", "1");
    } catch {
      /* noop */
    }
    onUnauthorized();
    router.replace("/login");
  };

  async function handleNewNoteIn(folderId: string | null) {
    try {
      setError(null);
      const draft = await api.createNote(token, {
        folder_id: folderId,
        tag_ids: selectedTagId ? [selectedTagId] : [],
      });
      await activateFreshDraft(draft);
      if (folderId) expandFolder(folderId);
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleNewNote() {
    try {
      setError(null);
      const draft = await api.createNote(token, {
        folder_id: null,
        tag_ids: selectedTagId ? [selectedTagId] : [],
      });
      await activateFreshDraft(draft);
      setSelectedFolderId(undefined);
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleOpenTodayNote() {
    try {
      setError(null);
      const dailyTitle = todayNoteTitle();
      const rows = await api.listNotes(token, { archived: false, trash: false });
      const existing = rows.find((n) => (n.title || "").trim() === dailyTitle);
      if (existing) {
        await loadNote(existing.id);
        return;
      }
      const draft = await api.createNote(token, {
        title: dailyTitle,
        content: `# ${dailyTitle}\n\n`,
        folder_id: null,
        tag_ids: [],
      });
      await activateFreshDraft(draft);
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleMoveNoteFolder(ev: ChangeEvent<HTMLSelectElement>) {
    if (!activeNoteId || !activeNote) return;
    const id = ev.target.value;
    try {
      setSaveState("saving");
      const updated = await patchNote(token, activeNoteId, { folder_id: id || null });
      setActiveNote(updated);
      setSaveState("saved");
      void reloadNotes();
    } catch (e) {
      handleApiError(e);
      setSaveState("dirty");
    }
  }

  async function toggleTagForActive(tag: Tag, checked: boolean) {
    if (!activeNoteId || !activeNote) return;
    const current = new Set(activeNote.tags.map((t) => t.id));
    if (checked) current.add(tag.id);
    else current.delete(tag.id);
    try {
      setSaveState("saving");
      const updated = await api.setNoteTags(token, activeNoteId, Array.from(current));
      setActiveNote(updated);
      setSaveState("saved");
      void reloadNotes();
    } catch (e) {
      handleApiError(e);
      setSaveState("dirty");
    }
  }

  /** 이름으로 태그를 만들어(이미 있으면 그 태그를) 현재 노트에 붙인다. */
  async function createTagForActive(rawName: string) {
    const name = rawName.trim().replace(/^#+/, "").trim();
    if (!name || !activeNoteId || !activeNote) return;
    try {
      const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
      const tag = existing ?? (await api.createTag(token, name));
      if (!existing) await refreshMeta();
      await toggleTagForActive(tag, true);
    } catch (e) {
      handleApiError(e);
    }
  }

  async function toggleFavorite() {
    if (!activeNoteId || !activeNote) return;
    try {
      const updated = await patchNote(token, activeNoteId, { is_favorite: !activeNote.is_favorite });
      setActiveNote(updated);
      void reloadNotes();
    } catch (e) {
      handleApiError(e);
    }
  }

  async function toggleArchive() {
    if (!activeNoteId || !activeNote) return;
    try {
      const updated = await patchNote(token, activeNoteId, { is_archived: !activeNote.is_archived });
      setActiveNote(updated);
      void reloadNotes();
    } catch (e) {
      handleApiError(e);
    }
  }

  // ---------- 첨부·녹음 ----------
  const { handleUpload, uploadAndInsert, handleDeleteAttachment, handleDropFiles, audioRecorder } = useAttachments({
    token,
    session,
    loadNote,
    refreshUsage,
    askConfirm,
    handleApiError,
    setError,
  });

  async function handleRestoreVersion(v: NoteVersion) {
    if (!activeNoteId) return;
    if (!window.confirm(`버전 #${v.version_index} (${REASON_LABEL[v.reason]}) 으로 되돌릴까요?`)) return;
    try {
      const restored = await api.restoreVersion(token, activeNoteId, v.id);
      if (restored.updated_link_note_count != null) {
        setLinkNotice({ count: restored.updated_link_note_count });
      }
      await loadNote(activeNoteId);
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleExport() {
    try {
      await api.downloadMarkdownExport(token);
    } catch (e) {
      handleApiError(e);
    }
  }

  // ---------- 동기화: 다른 기기의 변경을 몇 초 간격으로 가져오고, 기기 사본을 최신으로 ----------
  useNoteSync({
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
  });

  /** 노트를 열고 해당 줄(0부터)로 캐럿을 옮긴다 — 백링크·할 일 패널에서 쓴다. */
  async function openNoteAtLine(noteId: string, lineIndex: number): Promise<void> {
    if (activeNoteIdRef.current !== noteId) await loadNote(noteId);
    // 노트가 바뀌면 에디터가 새로 만들어진다. 화면에 올라온 뒤에 옮긴다.
    window.setTimeout(() => {
      const view = editorViewRef.current;
      if (!view || activeNoteIdRef.current !== noteId) return;
      const doc = view.state.doc;
      const line = doc.line(Math.min(Math.max(1, lineIndex + 1), doc.lines));
      view.dispatch({ selection: { anchor: line.to }, scrollIntoView: true });
      view.focus();
    }, 120);
  }

  // ---------- 템플릿 ----------
  const { handleTemplateNote, handleTemplateInsert, templateCommands } = useTemplates({
    token,
    session,
    templateSettings,
    folders,
    templateDialog,
    setTemplateDialog,
    confirmOpen: !!confirmDialog,
    paletteOpen: palette.open,
    activateFreshDraft,
    flushDraftForNote,
    flushOverlayForNote,
    setExpandedFolders,
    setSelectedFolderId,
    setError,
    handleApiError,
  });

  const appCommands = buildAppCommands({
    activeNoteId,
    drawingMode,
    rightPanel,
    setRightPanel,
    setDrawingMode,
    setSidebarCollapsed,
    imageInputRef,
    searchInputRef,
    handleNewNote,
    handleOpenTodayNote,
    handleExport,
  }).concat(templateCommands);


  const {
    slashMenu,
    slashSelected,
    setSlashSelected,
    filteredSlashCommands,
    slashMenuExtension,
    updateFromView: updateSlashMenuFromView,
  } = useSlashMenu({
    editorViewRef,
    insertTextAtCursor: (text) => insertTextAtCursor(editorViewRef.current, text),
    imageInputRef,
    setDrawingMode,
    startAudioRecording: audioRecorder.start,
    suspended: !!templateDialog || !!confirmDialog,
  });

  // ---------- 에디터 확장 (위키링크 이동·자동완성, 첨부 넣기, 슬래시 메뉴) ----------
  const { navigateToWikilink, codeMirrorExtensions } = useEditorExtensions({
    token,
    session,
    folders,
    linkCandidates,
    linkCandidatesRef,
    loadNote,
    reloadNotes,
    uploadAndInsert,
    slashMenuExtension,
    setError,
    handleApiError,
  });

  // ---------- Render ----------

  // ---------- 데스크탑 옵시디언풍 사이드 ----------

  const ribbonCard = (
    <WorkbenchRibbon
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
      newNoteDisabled={debouncedQuery.length >= 1}
      onNewNote={handleNewNote}
      mode={mode}
      onModeChange={(next) => {
        setMode(next);
        setSelectedTagId(undefined);
      }}
      onOpenTemplates={() => setTemplateDialog(true)}
      onLogout={onLogout}
    />
  );

  // ---------- 폴더 트리 빌드 ----------
  const showTree = mode === "active" && !debouncedQuery;
  // 폴더 트리 / 검색 / DnD / 멀티선택은 ./WorkbenchSidebar 로 분리. 상태와 핸들러
  // 는 ./useSidebarTree 가 들고 있고, 이 컴포넌트는 props 로만 표시한다. (renderNoteRow,
  // renderTreeItems, sidebarCard JSX, 그리고 두 개의 작은 derived 값
  // rootNotesNode / draggingNeedsRootLanding 도 모두 그쪽으로 이사.)
  // 사이드바는 React.memo — 본문 입력으로 Workbench 가 다시 그려질 때 트리 전체를
  // 다시 그리지 않도록 핸들러를 고정해서 넘긴다.
  const sidebarHandlers = useStableHandlers({
    handleNewNoteIn: (id: string | null) => void handleNewNoteIn(id),
    loadNote: (id: string) => void loadNote(id),
    handleExport: () => void handleExport(),
  });
  const sidebarCard = (
    <WorkbenchSidebar
      query={query}
      onQueryChange={setQuery}
      searchInputRef={searchInputRef}
      activeSearchTagToken={activeSearchTagToken}
      tagAutocomplete={tagAutocomplete}
      applyTagAutocomplete={applyTagAutocomplete}
      mode={mode}
      folderOptions={folderOptions}
      allFoldersExpanded={allFoldersExpanded}
      toggleExpandAllFolders={toggleExpandAllFolders}
      beginCreateFolder={beginCreateFolder}
      handleNewNoteIn={sidebarHandlers.handleNewNoteIn}
      debouncedQuery={debouncedQuery}
      notes={notesWithLiveTitle}
      expandedFolders={expandedFolders}
      toggleFolderExpanded={toggleFolderExpanded}
      childrenOf={childrenOf}
      notesInFolder={notesInFolder}
      showTree={showTree}
      activeNoteId={activeNoteId}
      selectedNoteIds={selectedNoteIds}
      setSelectedFolderId={setSelectedFolderId}
      handleSelectNote={handleSelectNote}
      loadNote={sidebarHandlers.loadNote}
      renaming={renaming}
      setRenaming={setRenaming}
      commitRename={commitRename}
      cancelRename={cancelRename}
      creatingFolder={creatingFolder}
      setCreatingFolder={setCreatingFolder}
      commitCreateFolder={commitCreateFolder}
      cancelCreateFolder={cancelCreateFolder}
      setContextMenu={setContextMenu}
      scheduleHoverMeta={scheduleHoverMeta}
      setHoverMeta={setHoverMeta}
      clearHoverMeta={clearHoverMeta}
      draggedItem={draggedItem}
      setDraggedItem={setDraggedItem}
      draggedItemRef={draggedItemRef}
      folderDropHoverId={folderDropHoverId}
      setFolderDropHoverId={setFolderDropHoverId}
      rootDropActive={rootDropActive}
      setRootDropActive={setRootDropActive}
      canDropIntoFolder={canDropIntoFolder}
      dropOnto={dropOnto}
      usage={usage}
      handleExport={sidebarHandlers.handleExport}
    />
  );

  const editorCard = (
    <WorkbenchEditorCard
      activeNote={activeNote}
      onNewNote={handleNewNote}
      saveState={saveState}
      folderOptions={folderOptions}
      onMoveNoteFolder={handleMoveNoteFolder}
      onToggleFavorite={() => void toggleFavorite()}
      onToggleArchive={() => void toggleArchive()}
      onDeleteNote={() => {
        if (activeNote) void deleteNoteWithConfirm(activeNote.id, activeNote.title);
      }}
      imageInputRef={imageInputRef}
      onPickImageFile={(file) => void uploadAndInsert(file)}
      onDropFiles={handleDropFiles}
      isRecording={audioRecorder.isRecording}
      onToggleAudioRecording={() => {
        if (audioRecorder.isRecording) audioRecorder.stop();
        else void audioRecorder.start();
      }}
      rightPanel={rightPanel}
      setRightPanel={setRightPanel}
      drawingMode={drawingMode}
      setDrawingMode={setDrawingMode}
      drawingTool={drawingTool}
      setDrawingTool={setDrawingTool}
      drawingColor={drawingColor}
      setDrawingColor={setDrawingColor}
      drawingWidth={drawingWidth}
      setDrawingWidth={setDrawingWidth}
      overlayHandleRef={overlayHandleRef}
      overlayStrokes={overlayStrokes}
      setOverlayStrokes={setOverlayStrokes}
      askConfirm={askConfirm}
      titleInputRef={titleInputRef}
      title={title}
      onTitleChange={(next) => {
        draftTitleRef.current = next;
        setTitle(next);
        const duplicate = notes.some((note) =>
          note.id !== activeNoteId && !note.deleted_at &&
          (note.folder_id ?? null) === (activeNote?.folder_id ?? null) &&
          note.title.trim().toLowerCase() === next.trim().toLowerCase(),
        );
        setTitleWarning(duplicate ? "같은 폴더에 같은 이름의 노트가 이미 있습니다. 다른 곳을 클릭하면 무제 노트 이름으로 변경됩니다." : null);
        scheduleAutosave();
      }}
      onTitleCompositionStart={handleCompositionStart}
      onTitleCompositionEnd={handleTitleCompositionEnd}
      onTitleBlur={() => void flushAutosave()}
      allTags={tags}
      onToggleTagForActive={toggleTagForActive}
      onCreateTagForActive={createTagForActive}
      content={content}
      onBodyChange={(value) => {
        draftContentRef.current = value;
        setContent(value);
        if (!composingRef.current && !applyingRemoteRef.current) scheduleAutosave();
        const view = editorViewRef.current;
        if (view) updateSlashMenuFromView(view);
      }}
      codeMirrorExtensions={codeMirrorExtensions}
      onEditorMount={(view) => {
        editorViewRef.current = view;
      }}
      slashMenu={slashMenu}
      filteredSlashCommands={filteredSlashCommands}
      slashSelected={slashSelected}
      setSlashSelected={setSlashSelected}
    />
  );

  // ---------- 우측 토글 패널: 첨부 / 할 일 / 버전 ----------
  const rightPanelCard =
    activeNote && !activeNote.deleted_at && rightPanel ? (
      <WorkbenchRightPanel
        activeNote={activeNote}
        rightPanel={rightPanel}
        setRightPanel={setRightPanel}
        token={token}
        handleUpload={handleUpload}
        handleDeleteAttachment={handleDeleteAttachment}
        todoItems={todoItems}
        todoLoading={todoLoading}
        refreshTodoItems={refreshTodoItems}
        toggleTodoFromPanel={toggleTodoFromPanel}
        openNoteAtLine={openNoteAtLine}
        versions={versions}
        handleRestoreVersion={handleRestoreVersion}
        backlinks={backlinks}
        brokenLinks={brokenLinks}
        backlinksLoading={backlinksLoading}
        refreshBacklinks={refreshBacklinks}
        openLinkTitle={(title) => navigateToWikilink(title)}
      />
    ) : null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white">
      <StatusBanners
        linkNotice={linkNotice}
        offline={offline}
        keepsDeviceCopy={offlineStore.isActive()}
        warning={titleWarning || error}
        onDismissWarning={() => {
          setError(null);
          setTitleWarning(null);
        }}
      />

      <CommandPalette
        open={palette.open}
        query={palette.query}
        onQueryChange={palette.setQuery}
        filteredCommands={palette.filter(appCommands)}
        inputRef={palette.inputRef}
        onClose={palette.close}
        onRun={palette.run}
      />

      {templateDialog ? <TemplateManager
        token={token} settings={templateSettings} folders={folders}
        onSettings={(settings) => { setTemplateSettings(settings); void offlineStore.setKv("templates", settings); }}
        onClose={() => setTemplateDialog(null)} onCreate={handleTemplateNote}
        canInsert={!!activeNote && !activeNote.deleted_at} onInsert={handleTemplateInsert}
        confirm={(message) => askConfirm({ title: "템플릿 변경", message, confirmLabel: "확인" })}
        confirmationOpen={!!confirmDialog}
      /> : null}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          className={`grid min-h-0 flex-1 ${
            rightPanel
              ? sidebarCollapsed
                ? "grid-cols-[44px_0px_minmax(0,1fr)_320px]"
                : "grid-cols-[44px_260px_minmax(0,1fr)_320px]"
              : sidebarCollapsed
                ? "grid-cols-[44px_0px_minmax(0,1fr)]"
                : "grid-cols-[44px_260px_minmax(0,1fr)]"
          }`}
        >
          {ribbonCard}
          <div className={sidebarCollapsed ? "min-h-0 overflow-hidden border-r-0" : "min-h-0"}>{sidebarCard}</div>
          <div className="min-h-0 min-w-0 bg-white">{editorCard}</div>
          {rightPanelCard}
        </div>

        <ContextMenu
          target={contextMenu}
          onClose={() => setContextMenu(null)}
          onNewRootNote={() => void handleNewNoteIn(null)}
          onNewRootFolder={() => beginCreateFolder(null)}
          onNewNoteIn={(id) => void handleNewNoteIn(id)}
          onNewSubfolder={(id) => beginCreateFolder(id)}
          onRenameFolder={(id) => beginRename("folder", id)}
          onDeleteFolder={(id) => void handleDeleteFolder(id)}
          onRenameNote={(id) => beginRename("note", id)}
          onDeleteNote={(id) => void handleNoteContextDelete(id)}
        />

        <HoverTooltip meta={hoverMeta} />

        <ConfirmDialog state={confirmDialog} onResolve={closeConfirm} />
      </div>
    </div>
  );
}

