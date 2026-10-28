"use client";

import { useRouter } from "next/navigation";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";
import { IconArchive, IconFile, IconList, IconLogOut, IconPlus, IconSidebarToggle, IconStar } from "./Icons";
import {
  cmEditorVisualTheme,
  editorChecklistAutoTrigger,
  editorCursorBackupSync,
  editorCursorTracker,
  editorMediaInputHandlers,
  editorMouseHandlers,
  editorNavAndDeleteKeymap,
  editorQuoteEnterKeymap,
  editorUndoRedoKeymap,
  hybridMarkdownField,
  memoEditorContextExtension,
} from "./editor";
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
  NoteTemplate,
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
import { ConfirmDialog, ContextMenu, HoverTooltip } from "./WorkbenchOverlays";
import { WorkbenchSidebar } from "./WorkbenchSidebar";
import { WorkbenchRightPanel } from "./WorkbenchRightPanel";
import { WorkbenchEditorCard } from "./WorkbenchEditor";
import { buildAppCommands } from "./workbenchCommands";
import { wikilinkAutocompleteExtension } from "./wikilinkExtension";
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
import { useStableHandlers } from "./useStableHandlers";
import { templateShortcut, shortcutLabel } from "./templateShortcuts";
import { renderTemplate } from "./templateVariables";
import { buildLinkCandidates, resolveLink, newLinkTarget, linkCreationLocation, folderLinkPath, type LinkNote } from "./wikilinkPaths";

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
  const templateCreationBusy = useRef(false);
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
  // Facet 컨텍스트의 insert/navigate 는 확장이 안정적이어야 하므로, 최신 구현은 ref 로 전달.
  const memoEditorInsertFileRef = useRef<(file: File) => void>(() => {});
  const memoEditorNavigateLinkRef = useRef<(title: string) => void>(() => {});
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
      if (folderId) {
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          next.add(folderId);
          return next;
        });
      }
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

  async function handleTemplateNote(template: NoteTemplate) {
    if (templateCreationBusy.current) return false;
    templateCreationBusy.current = true;
    try {
      setError(null);
      const current = activeNoteRef.current;
      if (current && !current.deleted_at) {
        if (!(await flushDraftForNote(current.id, current, { commit: true })) || !(await flushOverlayForNote(current.id))) return false;
      }
      const draft = await api.createNote(token, { template_id: template.id, folder_id: template.target_folder_id, template_timezone_offset: new Date().getTimezoneOffset() });
      await activateFreshDraft(draft);
      setTemplateDialog(null);
      setSelectedFolderId(template.target_folder_id ?? undefined);
      setExpandedFolders((previous) => {
        const next = new Set(previous);
        let folderId = template.target_folder_id;
        const seen = new Set<string>();
        while (folderId && !seen.has(folderId)) {
          seen.add(folderId);
          next.add(folderId);
          folderId = folders.find((folder) => folder.id === folderId)?.parent_id ?? null;
        }
        return next;
      });
      return true;
    } catch (e) { handleApiError(e); return false; }
    finally { templateCreationBusy.current = false; }
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

  async function handleListItemAction(item: NoteListItem) {
    const label = item.title || "(무제 노트)";
    if (
      !(await askConfirm({
        title: "노트 삭제",
        message: `'${label}' 노트를 삭제하시겠어요? 이 작업은 되돌릴 수 없습니다.`,
      }))
    ) {
      return;
    }
    try {
      await api.deleteNote(token, item.id);
      await reloadNotes();
      void refreshUsage();
      if (activeNoteId === item.id) closeActiveNote();
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

  function handleTemplateInsert(template: NoteTemplate): boolean {
    const note = activeNoteRef.current;
    const view = editorViewRef.current;
    if (!note || note.deleted_at || !view || composingRef.current || view.composing) return false;
    const inserted = insertTextAtCursor(view, renderTemplate(template.content, titleInputRef.current?.value ?? draftTitleRef.current));
    if (!inserted) return false;
    setTemplateDialog(null);
    window.setTimeout(() => {
      if (activeNoteIdRef.current === note.id && editorViewRef.current === view) view.focus();
    }, 0);
    return true;
  }

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

  const templateCreateRef = useRef(handleTemplateNote);
  templateCreateRef.current = handleTemplateNote;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (templateDialog || confirmDialog || palette.open || event.repeat || event.getModifierState("AltGraph")) return;
      const shortcut = templateShortcut(event);
      if (!shortcut) return;
      const template = templateSettings.templates.find((item) => item.shortcut === shortcut);
      if (!template) return;
      event.preventDefault(); event.stopPropagation();
      void templateCreateRef.current(template);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [templateSettings, templateDialog, confirmDialog, palette.open]);

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
  }).concat([
    { id: "manage-templates", title: "노트 템플릿 관리", description: "", keywords: "template 템플릿 양식", run: () => setTemplateDialog(true) },
    ...templateSettings.templates.map((template) => ({
      id: `template-${template.id}`, title: `${template.name} 새 노트`,
      description: folderLinkPath(template.target_folder_id, folders) || "루트",
      shortcut: shortcutLabel(template.shortcut), keywords: `template 템플릿 ${template.name}`,
      disabled: !!template.target_folder_id && !folders.some((folder) => folder.id === template.target_folder_id),
      run: () => void handleTemplateNote(template),
    })),
    ...templateSettings.templates.map((template) => ({
      id: `insert-template-${template.id}`, title: `${template.name} 현재 노트에 삽입`,
      description: "", keywords: `template 템플릿 삽입 ${template.name}`,
      disabled: !activeNote || !!activeNote.deleted_at || !template.content,
      run: () => void handleTemplateInsert(template),
    })),
  ]);


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

  // ---------- 위키링크 클릭 네비게이션 + 신규 노트 생성 ----------

  // 같은 제목의 노트가 이미 있으면 그걸 열고, 없으면 새로 만들고 본문에 링크만
  // 박는다. autocomplete 확장에서 "새 노트 만들기" 항목을 고를 때 이 함수를
  // 호출한다. 만든 노트로 곧장 이동하지는 않는다 (사용자가 편집하던 노트의
  // 흐름을 끊지 않기 위해). 그 노트로 가고 싶으면 새로 박힌 위키링크를 클릭하면
  // navigateToWikilink 가 그때 연다.
  const handleCreateNoteFromWikilink = useCallback(
    async (target: string) => {
      const location = linkCreationLocation(target, folders);
      if (!location) {
        setError("링크의 폴더 경로를 찾을 수 없거나 같은 경로가 여러 개 있습니다.");
        return;
      }
      try {
        await api.createNote(token, { title: location.title, folder_id: location.folderId });
        await reloadNotes();
      } catch (e) {
        handleApiError(e);
      }
    },
    [handleApiError, reloadNotes, token, folders],
  );

  // 위키링크 클릭 → 같은 제목 노트로 이동. 없으면 그 자리에서 만든다.
  const navigateToWikilink = useCallback(
    async (rawTitle: string) => {
      const title = rawTitle.trim();
      if (!title) return;
      const matches = resolveLink(title, linkCandidates, activeNoteRef.current?.folder_id ?? null);
      if (matches.length > 1) {
        setError(`'${title}' 링크에 여러 노트가 해당합니다. 선택창에서 폴더 경로를 골라 다시 연결해 주세요.`);
        return;
      }
      try {
        if (matches.length === 1) {
          await loadNote(matches[0].id);
          return;
        }
        const target = newLinkTarget(title, activeNoteRef.current?.folder_id ?? null, folders);
        const location = linkCreationLocation(target, folders);
        if (!location) {
          setError("링크의 폴더 경로를 찾을 수 없거나 같은 경로가 여러 개 있습니다.");
          return;
        }
        const draft = await api.createNote(token, { title: location.title, folder_id: location.folderId });
        await reloadNotes();
        await loadNote(draft.id);
      } catch (e) {
        handleApiError(e);
      }
    },
    [handleApiError, loadNote, linkCandidates, folders, reloadNotes, token],
  );

  memoEditorInsertFileRef.current = (file) => void uploadAndInsert(file);
  memoEditorNavigateLinkRef.current = (title) => void navigateToWikilink(title);

  const memoEditorContextExt = useMemo(
    () =>
      memoEditorContextExtension({
        token,
        apiUrl: api.API_URL,
        insertFile: (file) => memoEditorInsertFileRef.current(file),
        navigateLink: (title) => memoEditorNavigateLinkRef.current(title),
      }),
    [token],
  );

  // 위키링크 autocomplete 확장은 한 번만 구성한다. notes 가 바뀔 때마다 확장을
  // 새로 만들면 CodeMirror 가 reconfig 를 일으켜 무겁고, autocomplete 메뉴가
  // 열려 있는 동안 상태가 깨진다. 그래서 실제 데이터(notes / 노트 생성 콜백) 는
  // ref 로 들고, 확장은 ref 를 통해 항상 최신 클로저를 읽는다.
  const wikilinkFoldersRef = useRef(folders);
  wikilinkFoldersRef.current = folders;
  const wikilinkCreateRef = useRef(handleCreateNoteFromWikilink);
  wikilinkCreateRef.current = handleCreateNoteFromWikilink;
  const wikilinkExt = useMemo(
    () =>
      wikilinkAutocompleteExtension({
        getNotes: () => linkCandidatesRef.current,
        getNewNoteTarget: (title) => newLinkTarget(title, activeNoteRef.current?.folder_id ?? null, wikilinkFoldersRef.current),
        createNote: (title) => void wikilinkCreateRef.current(title),
      }),
    [],
  );

  const codeMirrorExtensions = useMemo(
    () => [
      memoEditorContextExt,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      hybridMarkdownField,
      EditorView.lineWrapping,
      cmEditorVisualTheme,
      editorMouseHandlers,
      editorMediaInputHandlers,
      editorCursorTracker,
      editorCursorBackupSync,
      editorChecklistAutoTrigger,
      editorUndoRedoKeymap,
      editorQuoteEnterKeymap,
      editorNavAndDeleteKeymap,
      slashMenuExtension,
      wikilinkExt,
    ],
    [memoEditorContextExt, slashMenuExtension, wikilinkExt],
  );

  // ---------- Render ----------

  // ---------- 데스크탑 옵시디언풍 사이드 ----------

  const ribbonModes: Array<{ key: ListMode; label: string; Icon: typeof IconList }> = [
    { key: "active", label: "전체", Icon: IconList },
    { key: "favorite", label: "즐겨찾기", Icon: IconStar },
    { key: "archive", label: "아카이브", Icon: IconArchive },
  ];

  const ribbonCard = (
    <div className="flex h-full w-11 flex-col items-center gap-1 border-r border-ink-900/10 bg-[#f4f4f3] py-2 text-ink-900/55">
      <button
        type="button"
        title={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
        aria-label={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
        onClick={() => setSidebarCollapsed((v) => !v)}
        className="grid h-8 w-8 place-items-center rounded-md hover:bg-black/5 hover:text-ink-900"
      >
        <IconSidebarToggle size={16} />
      </button>
      <div className="my-1 h-[1px] w-6 bg-ink-900/10" />
      <button
        type="button"
        title="새 노트"
        aria-label="새 노트"
        disabled={debouncedQuery.length >= 1}
        onClick={handleNewNote}
        className="grid h-8 w-8 place-items-center rounded-md hover:bg-black/5 hover:text-ink-900 disabled:opacity-30"
      >
        <IconPlus size={16} />
      </button>
      {ribbonModes.map((m) => {
        const isOn = mode === m.key;
        const Icon = m.Icon;
        return (
          <button
            key={m.key}
            type="button"
            title={m.label}
            aria-label={m.label}
            onClick={() => {
              setMode(m.key);
              setSelectedTagId(undefined);
            }}
            className={`grid h-8 w-8 place-items-center rounded-md ${
              isOn ? "bg-black/10 text-ink-900" : "hover:bg-black/5 hover:text-ink-900"
            }`}
          >
            <Icon size={16} />
          </button>
        );
      })}
      <button type="button" title="노트 템플릿" aria-label="노트 템플릿" onClick={() => setTemplateDialog(true)} className="grid h-8 w-8 place-items-center rounded-md hover:bg-black/5 hover:text-ink-900"><IconFile size={16} /></button>
      <button
        type="button"
        title="로그아웃"
        aria-label="로그아웃"
        onClick={onLogout}
        className="mt-auto grid h-8 w-8 place-items-center rounded-md hover:bg-black/5 hover:text-ink-900"
      >
        <IconLogOut size={16} />
      </button>
    </div>
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
        if (!activeNote) return;
        void handleListItemAction({
          id: activeNote.id,
          title: activeNote.title,
          folder_id: activeNote.folder_id,
          is_favorite: activeNote.is_favorite,
          is_archived: activeNote.is_archived,
          created_at: activeNote.created_at,
          updated_at: activeNote.updated_at,
          deleted_at: activeNote.deleted_at,
          tags: activeNote.tags,
          revision: activeNote.revision,
          change_seq: activeNote.change_seq,
        });
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
      {linkNotice ? (
        <div role="status" aria-live="polite" className="pointer-events-none fixed left-1/2 top-4 z-50 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-md border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-800 shadow-lg">
          {linkNotice.count > 0
            ? `${linkNotice.count}개 노트의 링크가 변경되었습니다.`
            : "이름·경로가 변경되었습니다. 갱신할 링크는 없습니다."}
        </div>
      ) : null}
      {offline ? (
        <div className="border-b border-slate-300 bg-slate-100 px-4 py-1.5 text-[12px] text-slate-700">
          {offlineStore.isActive()
            ? "오프라인 — 이 기기에 보관한 사본으로 작업 중입니다. 고친 내용은 연결되면 서버에 반영됩니다."
            : "오프라인 — 서버에 연결할 수 없습니다. 이 기기는 노트 보관이 꺼져 있어, 지금 열린 노트만 이어서 쓸 수 있고 연결되면 저장됩니다."}
        </div>
      ) : null}
      {titleWarning || error ? (
        <div className="border-b border-amber-400/40 bg-amber-50 px-4 py-2 text-[13px] text-amber-900">
          ⚠️ {titleWarning || error}
          <button type="button" className="float-right ml-4 text-[11px] font-semibold" onClick={() => { setError(null); setTitleWarning(null); }}>
            숨김
          </button>
        </div>
      ) : null}

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

