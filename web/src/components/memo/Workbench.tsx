"use client";

import { useRouter } from "next/navigation";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";
import {
  IconArchive,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconFile,
  IconFilePlus,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconImage,
  IconList,
  IconLogOut,
  IconMic,
  IconMusic,
  IconPaperclip,
  IconPlus,
  IconSave,
  IconSearch,
  IconSidebarToggle,
  IconStar,
  IconStop,
  IconTrash,
  IconX,
} from "./Icons";
import { AuthenticatedImagePreview } from "./AuthenticatedImagePreview";
import {
  cmEditorVisualTheme,
  editorMouseHandlers,
  hybridMarkdownField,
  setEditorAuthContext,
} from "./editor";
import {
  REASON_LABEL,
  DND_MIME_NOTE,
  DND_MIME_NOTE_MULTI,
  DND_MIME_FOLDER,
  compareName,
  dndHasMime,
  formatBytes,
  formatDateTime,
} from "./utils";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from "react";

import type {
  Attachment,
  Folder,
  ListNotesQuery,
  NoteDetail,
  NoteListItem,
  NoteVersion,
  StorageUsage,
  Tag,
} from "@/lib/api";
import { ApiError, api } from "@/lib/api";

type Panel = "nav" | "list" | "editor";

type ListMode = "active" | "favorite" | "archive";

// (REASON_LABEL, formatBytes, formatDateTime, compareName, DND 상수, dndHasMime 은 ./utils 로 이동)
// (escapeHtml 등 마크다운 렌더링은 ./markdown 으로 이동)
// (CodeMirror 위젯/상태/테마/이벤트 핸들러는 ./editor 로 이동)

export function MemoWorkbench({
  token,
  onUnauthorized,
}: {
  token: string;
  onUnauthorized: () => void;
}) {
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [notes, setNotes] = useState<NoteListItem[]>([]);

  const [mode, setMode] = useState<ListMode>("active");
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(undefined);
  const [selectedTagId, setSelectedTagId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [activeNoteId, setActiveNoteId] = useState<string | undefined>(undefined);
  const [activeNote, setActiveNote] = useState<NoteDetail | undefined>(undefined);
  const [versions, setVersions] = useState<NoteVersion[]>([]);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");

  const [panel, setPanel] = useState<Panel>("list");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  // 데스크탑 우측 토글 패널: 평소엔 닫혀있고 버튼으로 "파일" / "버전" 중 하나 표시
  const [rightPanel, setRightPanel] = useState<"files" | "versions" | null>(null);
  // 옵시디언풍 폴더 트리: 어떤 폴더가 펼쳐져 있는지
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  // 우클릭 컨텍스트 메뉴 (폴더 / 노트 / 빈 영역)
  type ContextMenuTarget =
    | { kind: "folder"; id: string; x: number; y: number }
    | { kind: "note"; id: string; x: number; y: number }
    | { kind: "blank"; x: number; y: number };
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  // 인라인 이름 편집 (폴더 / 노트 통합)
  const [renaming, setRenaming] = useState<
    { kind: "folder" | "note"; id: string; draft: string } | null
  >(null);
  // 인라인 새 폴더 생성 (parentId=null이면 루트)
  const [creatingFolder, setCreatingFolder] = useState<
    { parentId: string | null; draft: string } | null
  >(null);
  // 드래그 앤 드롭: 끌고 있는 항목 (폴더 / 단일 노트 / 다중 노트)
  type DragItem =
    | { kind: "folder"; id: string }
    | { kind: "note"; id: string }
    | { kind: "note-multi"; ids: string[] };
  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null);
  // setState는 비동기라 dragstart 직후 첫 dragover에서 state가 stale.
  // ref로 즉시 동기 업데이트해서 dragover/drop은 ref를 본다.
  const draggedItemRef = useRef<DragItem | null>(null);
  // 드래그하여 폴더 row 위에 호버 중인 타깃 폴더 ID (폴더 안으로 이동만 — 형제 순서 변경 없음)
  const [folderDropHoverId, setFolderDropHoverId] = useState<string | null>(null);
  // 사이드바 헤더(루트) 드롭 활성화 표시
  const [rootDropActive, setRootDropActive] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
  } | null>(null);
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);
  type HoverMeta = {
    kind: "folder" | "note";
    id: string;
    label: string;
    createdAt?: string | null;
    updatedAt?: string | null;
    folderCount?: number;
    noteCount?: number;
    x: number;
    y: number;
  };
  const [hoverMeta, setHoverMeta] = useState<HoverMeta | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  // 노트 다중 선택(사이드바): 같은 folder_id 위계에서 Shift 범위 선택 지원
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const selectionAnchorRef = useRef<{ noteId: string; folderId: string | null } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 에디터 제목 input ref — 새 노트 직후 포커스
  const titleInputRef = useRef<HTMLInputElement>(null);
  /** create 직후 해당 노트가 마운트되면 제목으로 포커스 (useLayoutEffect에서 소비) */
  const pendingFocusNewNoteRef = useRef<string | null>(null);

  const saveTimerRef = useRef<number | null>(null);
  const lastSentRef = useRef<{ title: string; content: string }>({ title: "", content: "" });
  // CodeMirror EditorView — onCreateEditor 에서 채워짐. 첨부 마커 삽입에 사용.
  const editorViewRef = useRef<EditorView | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  // 음성 녹음 상태
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  // paste / drop 시 미디어 자동 삽입 — 최신 closure 를 ref 로 유지.
  const insertFromInputRef = useRef<(file: File) => void | Promise<void>>(() => undefined);
  // True while a Korean/Japanese/Chinese IME is composing a character.
  // We must not run the autosave debounce timer during composition,
  // otherwise React re-renders mid-composition and the in-progress jamo
  // (e.g. the last 한글 character) gets dropped.
  const composingRef = useRef(false);

  const handleApiError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorized();
      } else if (e instanceof ApiError) {
        setError(String(e.message ?? e.payload ?? "요청 오류"));
      } else {
        setError(String(e));
      }
    },
    [onUnauthorized],
  );

  const refreshMeta = useCallback(async () => {
    try {
      setError(null);
      const [folderRows, tagRows] = await Promise.all([api.listFolders(token), api.listTags(token)]);
      setFolders(folderRows.filter((f) => !f.deleted_at));
      setTags(tagRows.filter((t) => !t.deleted_at));
    } catch (e) {
      handleApiError(e);
    }
  }, [handleApiError, token]);

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
      const rows = await api.listNotes(token, params);
      setNotes(rows);
    } catch (e) {
      handleApiError(e);
    }
  }, [debouncedQuery, handleApiError, mode, selectedFolderId, selectedTagId, token]);

  useEffect(() => {
    void refreshMeta();
    void refreshUsage();
  }, [refreshMeta, refreshUsage]);

  // 에디터 내부 위젯이 첨부를 인증된 blob URL 로 hydrate 할 수 있도록
  // 모듈 전역에 토큰/api URL 을 주입한다. useEffect 는 첫 paint 이후라
  // 페이지 첫 로드 시 widget 의 첫 render 가 토큰 없이 동작하는 문제가 있어,
  // render 동안에도 동기적으로 한번 호출해 둔다 (모듈 전역 변수만 갱신하므로 안전).
  setEditorAuthContext({ token, apiUrl: api.API_URL });
  useEffect(() => {
    setEditorAuthContext({ token, apiUrl: api.API_URL });
    return () => setEditorAuthContext(null);
  }, [token]);

  // 페이지를 떠나면 진행 중인 녹음 스트림을 반드시 정리.
  useEffect(() => {
    return () => {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        /* noop */
      }
      recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
      recordingStreamRef.current = null;
      mediaRecorderRef.current = null;
    };
  }, []);

  // 에디터 DOM 에 paste / drop 으로 미디어가 들어오면 본문에 바로 삽입.
  // - Ctrl+V: 클립보드의 이미지 / 파일
  // - Drag & drop: 파일 드롭
  useEffect(() => {
    if (!editorReady) return;
    const view = editorViewRef.current;
    if (!view) return;
    const dom = view.dom;
    const onPaste = (ev: ClipboardEvent) => {
      const dt = ev.clipboardData;
      if (!dt) return;
      const files: File[] = [];
      // Chromium 은 items 에서 image 를 잡고, Firefox 는 files 에 직접 넣음.
      if (dt.items && dt.items.length > 0) {
        for (let i = 0; i < dt.items.length; i += 1) {
          const it = dt.items[i];
          if (it.kind === "file") {
            const f = it.getAsFile();
            if (f) files.push(f);
          }
        }
      } else if (dt.files && dt.files.length > 0) {
        for (let i = 0; i < dt.files.length; i += 1) files.push(dt.files[i]);
      }
      if (files.length === 0) return;
      // 텍스트가 같이 들어왔다면 무시 — 미디어가 우선.
      ev.preventDefault();
      ev.stopPropagation();
      for (const f of files) void insertFromInputRef.current(f);
    };
    const onDragOver = (ev: DragEvent) => {
      if (ev.dataTransfer && Array.from(ev.dataTransfer.types).includes("Files")) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
      }
    };
    const onDrop = (ev: DragEvent) => {
      const files = ev.dataTransfer?.files;
      if (!files || files.length === 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      for (let i = 0; i < files.length; i += 1) {
        void insertFromInputRef.current(files[i]);
      }
    };
    dom.addEventListener("paste", onPaste);
    dom.addEventListener("dragover", onDragOver);
    dom.addEventListener("drop", onDrop);
    return () => {
      dom.removeEventListener("paste", onPaste);
      dom.removeEventListener("dragover", onDragOver);
      dom.removeEventListener("drop", onDrop);
    };
  }, [editorReady]);

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
    setSelectedNoteIds((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(notes.map((n) => n.id));
      const next = new Set(Array.from(prev).filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [notes]);

  useEffect(() => {
    if (selectedNoteIds.size === 0) return;
    const onKeyDownDelete = (ev: KeyboardEvent) => {
      if (ev.key !== "Delete") return;
      const target = ev.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const editable =
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable ||
          !!target.closest(".cm-editor");
        if (editable) return;
      }
      ev.preventDefault();
      void handleDeleteSelectedNotes();
    };
    document.addEventListener("keydown", onKeyDownDelete);
    return () => document.removeEventListener("keydown", onKeyDownDelete);
  }, [handleDeleteSelectedNotes, selectedNoteIds.size]);

  const loadNote = useCallback(
    async (id: string) => {
      try {
        setError(null);
        setPanel("editor");
        setActiveNoteId(id);
        const note = await api.getNote(token, id);
        setActiveNote(note);
        setTitle(note.title);
        setContent(note.content);
        lastSentRef.current = { title: note.title, content: note.content };
        setSaveState("saved");
        const vers = await api.listVersions(token, id);
        setVersions(vers);
      } catch (e) {
        handleApiError(e);
      }
    },
    [handleApiError, token],
  );

  const flushAutosave = useCallback(
    async (forceSnapshot?: boolean) => {
      if (!activeNoteId || !activeNote || activeNote.deleted_at) return;
      const note = activeNote;
      const sameTitle = title === lastSentRef.current.title;
      const sameBody = content === lastSentRef.current.content;
      if (sameTitle && sameBody && !forceSnapshot) return;

      try {
        setSaveState("saving");
        const updated = await api.patchNote(token, activeNoteId, {
          title,
          content,
          tag_ids: note.tags.map((x) => x.id),
          folder_id: note.folder_id ?? null,
          force_snapshot: !!forceSnapshot,
        });
        setActiveNote(updated);
        lastSentRef.current = { title, content };
        setSaveState("saved");
        void reloadNotes();
        void refreshUsage();
        const vers = await api.listVersions(token, activeNoteId);
        setVersions(vers);
      } catch (e) {
        handleApiError(e);
        setSaveState("dirty");
      }
    },
    [activeNote, activeNoteId, content, handleApiError, refreshUsage, reloadNotes, title, token],
  );

  const scheduleAutosave = useCallback(() => {
    if (!activeNoteId || !activeNote || activeNote.deleted_at) return;
    setSaveState("dirty");
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    // Defer until composition ends — onCompositionEnd will re-call scheduleAutosave.
    if (composingRef.current) return;
    saveTimerRef.current = window.setTimeout(() => {
      void flushAutosave(false);
      saveTimerRef.current = null;
    }, 900);
  }, [activeNote, activeNoteId, flushAutosave]);

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
      setTitle(ev.currentTarget.value);
      scheduleAutosave();
    },
    [scheduleAutosave],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    const pending = pendingFocusNewNoteRef.current;
    if (!pending || pending !== activeNoteId) return;
    const note = activeNote;
    if (!note || note.id !== pending || note.deleted_at) return;
    pendingFocusNewNoteRef.current = null;
    const focusTitle = () => {
      const el = titleInputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      try {
        el.select();
      } catch {
        /* noop */
      }
    };
    focusTitle();
    // 모바일/PWA 등에서 첫 호출이 무시될 수 있어 한 틱 뒤 재시도.
    window.setTimeout(focusTitle, 0);
    window.setTimeout(focusTitle, 120);
  }, [activeNoteId, activeNote]);

  // 컨텍스트 메뉴: ESC 또는 바깥 클릭으로 닫기.
  // 메뉴 안 클릭은 무시해야 메뉴 버튼 onClick이 정상 발화한다.
  // (React stopPropagation은 document에 native로 등록한 리스너를 막지 못함)
  useEffect(() => {
    if (!contextMenu) return;
    const onDocMouseDown = (ev: MouseEvent) => {
      const menu = document.getElementById("tree-context-menu");
      if (menu && menu.contains(ev.target as Node)) return;
      setContextMenu(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  const folderOptions = useMemo(
    () =>
      folders
        .slice()
        .sort((a, b) => compareName(a.name, b.name) || a.id.localeCompare(b.id)),
    [folders],
  );
  const allFoldersExpanded =
    folderOptions.length > 0 && folderOptions.every((f) => expandedFolders.has(f.id));
  const toggleExpandAllFolders = useCallback(() => {
    setExpandedFolders(() => {
      if (allFoldersExpanded) return new Set<string>();
      return new Set(folderOptions.map((f) => f.id));
    });
  }, [allFoldersExpanded, folderOptions]);
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
    try {
      await api.logout(token);
    } catch {
      /* ignore */
    }
    onUnauthorized();
    router.replace("/login");
  };

  // 새 폴더 생성: 인라인 input row를 띄워 사용자가 이름을 입력하게 함
  function beginCreateFolder(parentId: string | null) {
    setRenaming(null);
    if (parentId) {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.add(parentId);
        return next;
      });
    }
    setCreatingFolder({ parentId, draft: "" });
  }
  function cancelCreateFolder() {
    setCreatingFolder(null);
  }
  async function commitCreateFolder() {
    const c = creatingFolder;
    if (!c) return;
    const name = c.draft.trim();
    setCreatingFolder(null);
    if (!name) return;
    try {
      await api.createFolder(token, name, c.parentId);
      await refreshMeta();
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleNewNoteIn(folderId: string | null) {
    try {
      setError(null);
      // user gesture context 안에서 먼저 focus를 한 번 가져온다.
      // (await 뒤로 미루면 모바일/PWA에서 키보드가 안 뜨는 경우가 있다.)
      titleInputRef.current?.focus({ preventScroll: true });
      const draft = await api.createNote(token, {
        title: "",
        content: "",
        folder_id: folderId,
        tag_ids: selectedTagId ? [selectedTagId] : [],
      });
      pendingFocusNewNoteRef.current = draft.id;
      await reloadNotes();
      await loadNote(draft.id);
      if (folderId) {
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          next.add(folderId);
          return next;
        });
      }
      if (typeof window !== "undefined" && window.innerWidth < 768) setPanel("editor");
    } catch (e) {
      handleApiError(e);
    }
  }

  function toggleFolderExpanded(folderId: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  // 인라인 이름 편집 (폴더/노트 공통)
  function beginRename(kind: "folder" | "note", id: string) {
    if (kind === "folder") {
      const f = folderOptions.find((x) => x.id === id);
      if (!f) return;
      setRenaming({ kind: "folder", id, draft: f.name });
    } else {
      const n = notes.find((x) => x.id === id);
      if (!n) return;
      setRenaming({ kind: "note", id, draft: n.title || "" });
    }
  }
  function cancelRename() {
    setRenaming(null);
  }
  async function commitRename() {
    const r = renaming;
    if (!r) return;
    const draft = r.draft.trim();
    setRenaming(null);
    try {
      if (r.kind === "folder") {
        const f = folderOptions.find((x) => x.id === r.id);
        if (!f || !draft || draft === f.name) return;
        await api.patchFolder(token, r.id, { name: draft });
        await refreshMeta();
      } else {
        const n = notes.find((x) => x.id === r.id);
        if (!n || draft === (n.title || "")) return;
        await api.patchNote(token, r.id, { title: draft });
        await reloadNotes();
        if (activeNoteId === r.id) {
          setTitle(draft);
        }
      }
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleNoteContextDelete(noteId: string) {
    const n = notes.find((x) => x.id === noteId);
    if (!n) return;
    const label = n.title || "(무제 노트)";
    const msg = `'${label}' 노트를 삭제하시겠어요? 이 작업은 되돌릴 수 없습니다.`;
    if (!(await askConfirm({ title: "노트 삭제", message: msg }))) return;
    try {
      await api.trashNote(token, noteId);
      await reloadNotes();
      void refreshUsage();
      if (activeNoteId === noteId) {
        setActiveNoteId(undefined);
        setActiveNote(undefined);
      }
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleMoveNoteToFolder(noteId: string, folderId: string | null) {
    try {
      const note = notes.find((n) => n.id === noteId);
      if (note && (note.folder_id ?? null) === folderId) return;
      await api.patchNote(token, noteId, { folder_id: folderId });
      await reloadNotes();
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

  async function handleMoveNotesToFolder(noteIds: string[], folderId: string | null) {
    try {
      const uniqueIds = Array.from(new Set(noteIds));
      const targets = uniqueIds.filter((id) => {
        const note = notes.find((n) => n.id === id);
        return note && (note.folder_id ?? null) !== folderId;
      });
      if (targets.length === 0) return;
      await Promise.all(targets.map((id) => api.patchNote(token, id, { folder_id: folderId })));
      await reloadNotes();
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

  async function handleMoveFolderToParent(folderId: string, parentId: string | null) {
    try {
      const f = folderOptions.find((x) => x.id === folderId);
      if (!f || (f.parent_id ?? null) === parentId) return;
      // 자기 자신/자기 자손 폴더로 이동 방지
      if (parentId) {
        let cur: string | null = parentId;
        while (cur) {
          if (cur === folderId) return; // 사이클
          const p = folderOptions.find((x) => x.id === cur);
          cur = p?.parent_id ?? null;
        }
      }
      await api.patchFolder(token, folderId, { parent_id: parentId });
      await refreshMeta();
      if (parentId) {
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          next.add(parentId);
          return next;
        });
      }
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleDeleteFolder(folderId: string) {
    const f = folderOptions.find((x) => x.id === folderId);
    if (!f) return;
    const childFolders = folderOptions.filter((x) => x.parent_id === folderId).length;
    const childNotes = notes.filter((n) => n.folder_id === folderId).length;
    let confirmMsg = `'${f.name}' 폴더를 삭제하시겠어요? 이 작업은 되돌릴 수 없습니다.`;
    if (childFolders > 0 || childNotes > 0) {
      confirmMsg =
        `'${f.name}' 폴더 안에 하위 폴더 ${childFolders}개, 노트 ${childNotes}개가 있습니다.\n` +
        `폴더를 삭제하면 안의 항목은 그대로 남고 루트로 이동합니다.\n` +
        `정말 삭제할까요? (되돌릴 수 없음)`;
    }
    if (!(await askConfirm({ title: "폴더 삭제", message: confirmMsg }))) return;
    try {
      await api.deleteFolder(token, folderId);
      if (selectedFolderId === folderId) setSelectedFolderId(undefined);
      await refreshMeta();
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleCreateTag() {
    const name = window.prompt("새 태그 이름", "아이디어");
    if (!name) return;
    try {
      await api.createTag(token, name.trim());
      await refreshMeta();
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleNewNote() {
    try {
      setError(null);
      titleInputRef.current?.focus({ preventScroll: true });
      const draft = await api.createNote(token, {
        title: "",
        content: "",
        folder_id: null,
        tag_ids: selectedTagId ? [selectedTagId] : [],
      });
      pendingFocusNewNoteRef.current = draft.id;
      await reloadNotes();
      await loadNote(draft.id);
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
      await api.trashNote(token, item.id);
      await reloadNotes();
      void refreshUsage();
      if (activeNoteId === item.id) {
        setActiveNoteId(undefined);
        setActiveNote(undefined);
        setTitle("");
        setContent("");
        setPanel("list");
      }
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleDeleteSelectedNotes() {
    const targetNotes = notes.filter((n) => selectedNoteIds.has(n.id));
    if (targetNotes.length === 0) return;
    const msg =
      targetNotes.length === 1
        ? `'${targetNotes[0].title || "(무제 노트)"}' 노트를 삭제하시겠어요? 이 작업은 되돌릴 수 없습니다.`
        : `선택한 노트 ${targetNotes.length}개를 삭제하시겠어요? 이 작업은 되돌릴 수 없습니다.`;
    if (!(await askConfirm({ title: "노트 삭제", message: msg }))) return;
    try {
      await Promise.all(targetNotes.map((n) => api.trashNote(token, n.id)));
      await reloadNotes();
      void refreshUsage();
      const removed = new Set(targetNotes.map((n) => n.id));
      if (activeNoteId && removed.has(activeNoteId)) {
        setActiveNoteId(undefined);
        setActiveNote(undefined);
        setTitle("");
        setContent("");
        setPanel("list");
      }
      setSelectedNoteIds(new Set());
      selectionAnchorRef.current = null;
    } catch (e) {
      handleApiError(e);
    }
  }

  async function restoreActiveNote() {
    if (!activeNote?.deleted_at) return;
    try {
      await api.restoreNote(token, activeNote.id);
      await reloadNotes();
      await loadNote(activeNote.id);
      setMode("active");
      setPanel("editor");
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleMoveNoteFolder(ev: ChangeEvent<HTMLSelectElement>) {
    if (!activeNoteId || !activeNote) return;
    const id = ev.target.value;
    try {
      setSaveState("saving");
      const updated = await api.patchNote(token, activeNoteId, { folder_id: id || null });
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

  async function toggleFavorite() {
    if (!activeNoteId || !activeNote) return;
    try {
      const updated = await api.patchNote(token, activeNoteId, { is_favorite: !activeNote.is_favorite });
      setActiveNote(updated);
      void reloadNotes();
    } catch (e) {
      handleApiError(e);
    }
  }

  async function toggleArchive() {
    if (!activeNoteId || !activeNote) return;
    try {
      const updated = await api.patchNote(token, activeNoteId, { is_archived: !activeNote.is_archived });
      setActiveNote(updated);
      void reloadNotes();
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files?.length || !activeNoteId) return;
    for (let i = 0; i < files.length; i += 1) {
      try {
        await api.uploadAttachment(token, activeNoteId, files.item(i)!);
      } catch (e) {
        handleApiError(e);
      }
    }
    if (activeNoteId) await loadNote(activeNoteId);
    void refreshUsage();
  }

  // 본문 cursor 위치에 첨부 마커 텍스트를 삽입한다.
  // - 위 / 아래에 빈 줄을 넣어 한 줄짜리 미디어 블록으로 보이게 한다.
  // - 삽입 후 caret을 마커 다음 줄로 옮긴다.
  function insertMarkerAtCursor(marker: string): boolean {
    const view = editorViewRef.current;
    if (!view) return false;
    const sel = view.state.selection.main;
    const doc = view.state.doc;
    const lineAtFrom = doc.lineAt(sel.from);
    const atLineStart = sel.from === lineAtFrom.from;
    const lineEmpty = lineAtFrom.text.trim().length === 0;
    let prefix = "";
    let suffix = "\n";
    if (!atLineStart) prefix = "\n";
    else if (!lineEmpty) prefix = "";
    const insertText = `${prefix}${marker}${suffix}`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: insertText },
      selection: { anchor: sel.from + insertText.length },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }

  function buildAttachmentMarker(att: { id: string; original_filename: string; kind?: string }): string {
    const safeName = att.original_filename.replaceAll("]", "").replaceAll("[", "");
    if (att.kind === "image") return `![${safeName}](attachment://${att.id})`;
    if (att.kind === "audio") return `![audio:${safeName}](attachment://${att.id})`;
    return `[${safeName}](attachment://${att.id})`;
  }

  // 툴바에서 부르는 업로드: 업로드 즉시 본문에 마커 자동 삽입.
  // 주의: loadNote 를 부르면 setContent 로 서버의 (마커 없는) 옛 본문이
  // 화면을 덮어써서 방금 삽입한 마커가 즉시 사라진다. 그래서 메타데이터(첨부 목록)
  // 만 갱신하고 title/content state 는 절대 건드리지 않는다.
  async function uploadAndInsert(file: File) {
    if (!activeNoteId) return;
    try {
      const att = await api.uploadAttachment(token, activeNoteId, file);
      insertMarkerAtCursor(buildAttachmentMarker({ ...att }));
      // 첨부 패널이 새 항목을 보이게끔 활성 노트 메타만 다시 가져온다.
      try {
        const fresh = await api.getNote(token, activeNoteId);
        setActiveNote(fresh);
      } catch {
        /* 메타 갱신 실패는 치명적이지 않음 */
      }
      void refreshUsage();
    } catch (e) {
      handleApiError(e);
    }
  }

  // paste/drop 핸들러가 항상 최신 uploadAndInsert 를 보도록 동기화.
  useEffect(() => {
    insertFromInputRef.current = uploadAndInsert;
  });

  async function startAudioRecording() {
    if (isRecording) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("이 브라우저는 음성 녹음을 지원하지 않습니다.");
      return;
    }
    if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") {
      setError("이 브라우저는 MediaRecorder를 지원하지 않습니다.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      // 가능한 mime 우선순위 (브라우저별 호환).
      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
      const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recordedChunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
        recordingStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);
        if (chunks.length === 0) return;
        const blobType = rec.mimeType || "audio/webm";
        const ext = blobType.includes("mp4") ? "m4a" : blobType.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(chunks, { type: blobType });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const file = new File([blob], `recording-${ts}.${ext}`, { type: blobType });
        await uploadAndInsert(file);
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setIsRecording(true);
    } catch (e) {
      handleApiError(e);
      recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
      recordingStreamRef.current = null;
    }
  }

  function stopAudioRecording() {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      /* noop */
    }
  }

  async function handleTrashAttachment(att: Attachment) {
    if (!window.confirm(`첨부를 휴지통으로 보낼까요? ${att.original_filename}`)) return;
    try {
      await api.trashAttachment(token, att.id);
      if (activeNoteId) await loadNote(activeNoteId);
      void refreshUsage();
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleRestoreVersion(v: NoteVersion) {
    if (!activeNoteId) return;
    if (!window.confirm(`버전 #${v.version_index} (${REASON_LABEL[v.reason]}) 으로 되돌릴까요?`)) return;
    try {
      await api.restoreVersion(token, activeNoteId, v.id);
      await loadNote(activeNoteId);
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleManualSnapshot() {
    if (!activeNoteId) return;
    try {
      await api.snapshotNote(token, activeNoteId);
      const vers = await api.listVersions(token, activeNoteId);
      setVersions(vers);
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

  // ---------- Render ----------

  const navCard = (
    <section className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-ink-900/45">사이드바</p>
          <h2 className="text-lg font-semibold">정리</h2>
        </div>
        <button
          type="button"
          className="rounded-full border border-ink-900/12 px-3 py-1 text-xs font-medium text-ink-900/70 hover:bg-ink-900/5"
          onClick={onLogout}
        >
          로그아웃
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["active", "일반"],
            ["favorite", "★ 즐겨찾기"],
            ["archive", "아카이브"],
          ] as const
        ).map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              mode === key
                ? key === "archive"
                  ? "bg-slate-600 text-white"
                  : key === "favorite"
                    ? "bg-yellow-500 text-white"
                    : "bg-ink-900 text-white"
                : "bg-ink-900/5 text-ink-900/75"
            }`}
            onClick={() => {
              setMode(key);
              setSelectedTagId(undefined);
              setPanel("list");
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-ink-900">폴더</p>
          <button type="button" className="text-xs text-sky-700 underline underline-offset-2" onClick={() => beginCreateFolder(null)}>
            추가
          </button>
        </div>
        <select
          className="block w-full rounded-xl border border-ink-900/12 bg-white px-3 py-2 text-[14px]"
          value={selectedFolderId ?? ""}
          disabled={debouncedQuery.length >= 1}
          onChange={(ev) => {
            setSelectedFolderId(ev.target.value || undefined);
            setSelectedTagId(undefined);
          }}
        >
          <option value="">모든 노트</option>
          {folderOptions.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2 overflow-y-auto">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-ink-900">태그 필터</p>
          <button type="button" className="text-xs text-sky-700 underline underline-offset-2" onClick={handleCreateTag}>
            추가
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => {
            const chosen = selectedTagId === tag.id;
            return (
              <button
                key={tag.id}
                type="button"
                disabled={debouncedQuery.length >= 1}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  chosen ? "border-ink-900 bg-ink-900 text-white" : "border-transparent bg-white text-ink-900/75 ring-1 ring-ink-900/10"
                }`}
                onClick={() => setSelectedTagId(chosen ? undefined : tag.id)}
              >
                #{tag.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-auto space-y-3 border-t border-ink-900/10 pt-3 text-xs text-ink-900/65">
        {usage ? (
          <div className="space-y-1 rounded-xl bg-white px-3 py-2 ring-1 ring-ink-900/10">
            <div className="flex items-center justify-between font-semibold text-ink-900">
              <span>저장소 사용량</span>
              <span>{formatBytes(usage.total_bytes)}</span>
            </div>
            <p className="text-[11px] text-ink-900/55">{usage.upload_root}</p>
            <ul className="text-[11px]">
              {Object.entries(usage.by_kind).map(([k, v]) => (
                <li key={k} className="flex justify-between gap-2">
                  <span>{k}</span>
                  <span>{formatBytes(Number(v))}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-ink-900/45">첨부 {usage.attachments_count}개</p>
          </div>
        ) : null}
        <button
          type="button"
          className="w-full rounded-xl border border-ink-900/15 bg-white px-3 py-2 font-semibold text-ink-900 hover:bg-ink-900 hover:text-white"
          onClick={handleExport}
        >
          Markdown으로 내보내기 (.zip)
        </button>
      </div>
    </section>
  );

  const listHeading =
    mode === "favorite" ? "즐겨찾기" : mode === "archive" ? "아카이브" : "목록";

  const listCard = (
    <section className="flex h-full flex-col border-ink-900/10 md:border-r">
      <header className="flex flex-col gap-3 border-b border-ink-900/10 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-ink-900/45">노트</p>
            <h2 className="text-lg font-semibold">{listHeading}</h2>
          </div>
          <button
            type="button"
            disabled={debouncedQuery.length >= 1}
            onClick={handleNewNote}
            className="rounded-full bg-ink-900 px-4 py-2 text-xs font-semibold text-white disabled:bg-ink-900/35"
          >
            새 노트
          </button>
        </div>
        <input
          placeholder="🔍 검색 (제목·본문·태그·첨부 파일명, ILIKE)"
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          className="rounded-xl border border-ink-900/12 px-3 py-2 text-sm shadow-sm outline-none focus:border-sky-500"
        />
      </header>
      <ul className="flex-1 divide-y divide-ink-900/6 overflow-y-auto">
        {notes.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-ink-900/50">표시할 노트가 없습니다.</li>
        ) : null}
        {notes.map((n) => {
          const isActive = n.id === activeNoteId;
          return (
            <li
              key={n.id}
              className={`flex flex-col gap-1 px-4 py-3.5 hover:bg-white active:bg-white/80 ${isActive ? "bg-white shadow-inner" : "bg-transparent"}`}
            >
              <div
                role="button"
                tabIndex={0}
                className="flex cursor-pointer flex-col items-start gap-1 text-left outline-none focus:ring-2 focus:ring-sky-500/40"
                onClick={() => void loadNote(n.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    void loadNote(n.id);
                  }
                }}
              >
                <span className="line-clamp-1 text-[15px] font-semibold text-ink-900">
                  {n.is_favorite ? <span className="mr-1 text-yellow-500">★</span> : null}
                  {n.title || "무제 노트"}
                  {n.is_archived ? (
                    <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-700">archive</span>
                  ) : null}
                </span>
                <span className="text-xs text-ink-900/50">
                  {new Date(n.updated_at).toLocaleString()} · 태그 {n.tags.length}
                </span>
                {n.tags.length > 0 ? (
                  <span className="flex flex-wrap gap-1 pt-1">
                    {n.tags.slice(0, 3).map((t) => (
                      <span
                        key={t.id}
                        className="rounded-full bg-ink-900/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-ink-900/65"
                      >
                        #{t.name}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="self-start text-[11px] font-semibold text-red-600"
                onClick={() => void handleListItemAction(n)}
              >
                삭제
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );

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
              setPanel("list");
            }}
            className={`grid h-8 w-8 place-items-center rounded-md ${
              isOn ? "bg-black/10 text-ink-900" : "hover:bg-black/5 hover:text-ink-900"
            }`}
          >
            <Icon size={16} />
          </button>
        );
      })}
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
  // 폴더는 folderOptions에서 compareName(숫자→영문→한글)으로만 정렬됨. filter로 유지.
  const childrenOf = (parentId: string | null) =>
    folderOptions.filter((f) => (f.parent_id ?? null) === parentId);
  // 노트는 별도 sort_order가 없으므로 매 렌더에서 이름 자연 정렬 (숫자→영문→한글)
  const notesInFolder = (folderId: string | null) =>
    notes
      .filter((n) => (n.folder_id ?? null) === folderId)
      .slice()
      .sort((a, b) => compareName(a.title || "", b.title || "") || a.id.localeCompare(b.id));

  const resolveDraggedPayload = useCallback(
    (ev: React.DragEvent): { noteId?: string; noteIds?: string[]; folderId?: string } => {
      const plain = ev.dataTransfer.getData("text/plain").trim();
      const noteMultiRaw = ev.dataTransfer.getData(DND_MIME_NOTE_MULTI);
      let folderId = ev.dataTransfer.getData(DND_MIME_FOLDER);
      let noteId = ev.dataTransfer.getData(DND_MIME_NOTE);
      let noteIds: string[] | undefined;
      if (noteMultiRaw) {
        try {
          const parsed = JSON.parse(noteMultiRaw);
          if (Array.isArray(parsed)) {
            noteIds = parsed.filter((x): x is string => typeof x === "string");
          }
        } catch {}
      }
      if (!folderId && !noteId && plain) {
        if (notes.some((x) => x.id === plain)) noteId = plain;
        else if (folderOptions.some((x) => x.id === plain)) folderId = plain;
      }
      return { noteId: noteId || undefined, noteIds, folderId: folderId || undefined };
    },
    [folderOptions, notes],
  );

  const handleSelectNote = useCallback(
    (note: NoteListItem, opts: { shiftKey: boolean; toggleKey: boolean }) => {
      const folderId = note.folder_id ?? null;
      const { shiftKey, toggleKey } = opts;
      if (toggleKey) {
        setSelectedNoteIds((prev) => {
          if (prev.size === 0) {
            selectionAnchorRef.current = { noteId: note.id, folderId };
            return new Set([note.id]);
          }
          const anchorFolder = selectionAnchorRef.current?.folderId ?? folderId;
          // 다중 선택은 같은 위계(같은 folder_id) 안에서만 허용.
          if (anchorFolder !== folderId) {
            selectionAnchorRef.current = { noteId: note.id, folderId };
            return new Set([note.id]);
          }
          const next = new Set(prev);
          if (next.has(note.id)) next.delete(note.id);
          else next.add(note.id);
          if (next.size === 0) selectionAnchorRef.current = null;
          else if (!selectionAnchorRef.current) selectionAnchorRef.current = { noteId: note.id, folderId };
          return next;
        });
        return;
      }
      if (!shiftKey) {
        setSelectedNoteIds(new Set([note.id]));
        selectionAnchorRef.current = { noteId: note.id, folderId };
        return;
      }
      const anchor = selectionAnchorRef.current;
      if (!anchor || anchor.folderId !== folderId) {
        setSelectedNoteIds(new Set([note.id]));
        selectionAnchorRef.current = { noteId: note.id, folderId };
        return;
      }
      const siblings = notesInFolder(folderId);
      const from = siblings.findIndex((n) => n.id === anchor.noteId);
      const to = siblings.findIndex((n) => n.id === note.id);
      if (from < 0 || to < 0) {
        setSelectedNoteIds(new Set([note.id]));
        selectionAnchorRef.current = { noteId: note.id, folderId };
        return;
      }
      const [start, end] = from <= to ? [from, to] : [to, from];
      setSelectedNoteIds(new Set(siblings.slice(start, end + 1).map((n) => n.id)));
    },
    [notes],
  );

  const canDropIntoFolder = useCallback(
    (folderId: string, item: DragItem | null): boolean => {
      if (!item) return false;
      if (item.kind === "note") {
        return (notes.find((n) => n.id === item.id)?.folder_id ?? null) !== folderId;
      }
      if (item.kind === "note-multi") {
        return item.ids.some((id) => (notes.find((n) => n.id === id)?.folder_id ?? null) !== folderId);
      }
      if (item.id === folderId) return false;
      const source = folderOptions.find((x) => x.id === item.id);
      if (!source) return false;
      let cur: string | null = folderId;
      while (cur) {
        if (cur === source.id) return false;
        const p = folderOptions.find((x) => x.id === cur);
        cur = p?.parent_id ?? null;
      }
      return true;
    },
    [folderOptions, notes],
  );

  const renderNoteRow = (n: NoteListItem, depth: number): ReactElement => {
    const isActive = n.id === activeNoteId;
    const isSelected = selectedNoteIds.has(n.id);
    const isRenaming = renaming?.kind === "note" && renaming.id === n.id;
    const isDragging =
      (draggedItem?.kind === "note" && draggedItem.id === n.id) ||
      (draggedItem?.kind === "note-multi" && draggedItem.ids.includes(n.id));
    return (
      <li key={`n-${n.id}`} className="list-none">
        <div
          role="button"
          tabIndex={0}
          draggable={!isRenaming}
          onDragStart={(ev) => {
            if (isRenaming) {
              ev.preventDefault();
              return;
            }
            ev.stopPropagation();
            const selectedInSameFolder = selectedNoteIds.has(n.id)
              ? notesInFolder(n.folder_id ?? null)
                  .map((x) => x.id)
                  .filter((id) => selectedNoteIds.has(id))
              : [];
            const dragNoteIds = selectedInSameFolder.length >= 2 ? selectedInSameFolder : [n.id];
            ev.dataTransfer.setData(DND_MIME_NOTE, n.id);
            if (dragNoteIds.length >= 2) {
              ev.dataTransfer.setData(DND_MIME_NOTE_MULTI, JSON.stringify(dragNoteIds));
            }
            ev.dataTransfer.setData("text/plain", n.id);
            ev.dataTransfer.effectAllowed = "move";
            const item: DragItem =
              dragNoteIds.length >= 2
                ? { kind: "note-multi", ids: dragNoteIds }
                : { kind: "note", id: n.id };
            draggedItemRef.current = item;
            // dragstart 동기 처리 중 setState로 DOM이 변경되면 일부 브라우저가
            // 드래그를 중단하므로, draggedItem 상태 갱신은 한 틱 미룬다.
            window.setTimeout(() => setDraggedItem(item), 0);
          }}
          onDragEnd={() => {
            draggedItemRef.current = null;
            setDraggedItem(null);
            setFolderDropHoverId(null);
            setRootDropActive(false);
          }}
          onContextMenu={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setContextMenu({ kind: "note", id: n.id, x: ev.clientX, y: ev.clientY });
          }}
          onClick={(ev) => {
            if (isRenaming) return;
            handleSelectNote(n, { shiftKey: ev.shiftKey, toggleKey: ev.metaKey || ev.ctrlKey });
            void loadNote(n.id);
          }}
          onKeyDown={(ev) => {
            if (isRenaming) return;
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              handleSelectNote(n, { shiftKey: false, toggleKey: false });
              void loadNote(n.id);
            }
          }}
          onMouseEnter={(ev) =>
            scheduleHoverMeta(
              {
                kind: "note",
                id: n.id,
                label: n.title || "무제 노트",
                createdAt: n.created_at,
                updatedAt: n.updated_at,
              },
              ev.clientX,
              ev.clientY,
            )
          }
          onMouseMove={(ev) => {
            setHoverMeta((prev) =>
              prev && prev.kind === "note" && prev.id === n.id
                ? { ...prev, x: ev.clientX, y: ev.clientY }
                : prev,
            );
          }}
          onMouseLeave={clearHoverMeta}
          className={`flex cursor-pointer items-center gap-1 rounded py-1 pr-2 outline-none ${
            isActive
              ? "bg-black/[0.08] text-ink-900"
              : isSelected
                ? "bg-black/[0.05] text-ink-900"
                : "hover:bg-black/5"
          } ${isDragging ? "opacity-40" : ""}`}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          <span className="grid h-5 w-5 place-items-center text-ink-900/40">
            <IconFile size={14} />
          </span>
          {isRenaming && renaming ? (
            <input
              autoFocus
              value={renaming.draft}
              onChange={(ev) =>
                setRenaming((prev) => (prev ? { ...prev, draft: ev.target.value } : prev))
              }
              onFocus={(ev) => ev.currentTarget.select()}
              onClick={(ev) => ev.stopPropagation()}
              onMouseDown={(ev) => ev.stopPropagation()}
              onDragStart={(ev) => ev.stopPropagation()}
              onBlur={() => void commitRename()}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.preventDefault();
                  void commitRename();
                } else if (ev.key === "Escape") {
                  ev.preventDefault();
                  cancelRename();
                }
              }}
              className="h-5 min-w-0 flex-1 rounded border border-sky-400 bg-white px-1 text-[13px] outline-none"
            />
          ) : (
            <span className="line-clamp-1 flex-1 text-[14px]">{n.title || "무제 노트"}</span>
          )}
          {!isRenaming && n.is_favorite ? (
            <span className="text-ink-900/55">
              <IconStar size={11} filled />
            </span>
          ) : null}
        </div>
      </li>
    );
  };

  const renderTreeItems = (parentId: string | null, depth: number): ReactElement[] => {
    const items: ReactElement[] = [];
    const folders = childrenOf(parentId);
    for (const f of folders) {
      const expanded = expandedFolders.has(f.id);
      const isRenaming = renaming?.kind === "folder" && renaming.id === f.id;
      const isDragging = draggedItem?.kind === "folder" && draggedItem.id === f.id;
      const isDropTarget = folderDropHoverId === f.id;
      items.push(
        <li
          key={`f-${f.id}`}
          /* border 로만 표시해 ring(외곽 페인팅)이 스크롤 컨테이너에서 잘리지 않게 함 */
          className={`list-none rounded-md ${isDropTarget ? "border border-sky-400 bg-sky-100/60" : "border border-transparent"}`}
          onDragOver={(ev) => {
            const item = draggedItemRef.current;
            if (!canDropIntoFolder(f.id, item)) return;
            ev.preventDefault();
            ev.stopPropagation();
            ev.dataTransfer.dropEffect = "move";
            setFolderDropHoverId(f.id);
          }}
          onDragLeave={(ev) => {
            const next = ev.relatedTarget as Node | null;
            if (!next || !(ev.currentTarget as HTMLElement).contains(next)) {
              if (folderDropHoverId === f.id) setFolderDropHoverId(null);
            }
          }}
          onDrop={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const ghost = draggedItemRef.current;
            const payload = resolveDraggedPayload(ev);
            draggedItemRef.current = null;
            setDraggedItem(null);
            setFolderDropHoverId(null);
            setRootDropActive(false);
            if (payload.noteIds && payload.noteIds.length >= 2) {
              void handleMoveNotesToFolder(payload.noteIds, f.id);
              return;
            }
            if (payload.noteId) {
              void handleMoveNoteToFolder(payload.noteId, f.id);
              return;
            }
            if (payload.folderId && payload.folderId !== f.id) {
              void handleMoveFolderToParent(payload.folderId, f.id);
              return;
            }
            if (ghost?.kind === "note") {
              void handleMoveNoteToFolder(ghost.id, f.id);
              return;
            }
            if (ghost?.kind === "note-multi") {
              void handleMoveNotesToFolder(ghost.ids, f.id);
              return;
            }
            if (ghost?.kind === "folder" && ghost.id !== f.id) {
              void handleMoveFolderToParent(ghost.id, f.id);
            }
          }}
        >
          <div
            draggable={!isRenaming}
            onDragStart={(ev) => {
              if (isRenaming) {
                ev.preventDefault();
                return;
              }
              ev.stopPropagation();
              ev.dataTransfer.setData(DND_MIME_FOLDER, f.id);
              ev.dataTransfer.setData("text/plain", f.id);
              ev.dataTransfer.effectAllowed = "move";
              const item: DragItem = { kind: "folder", id: f.id };
              draggedItemRef.current = item;
              window.setTimeout(() => setDraggedItem(item), 0);
            }}
            onDragEnd={() => {
              draggedItemRef.current = null;
              setDraggedItem(null);
              setFolderDropHoverId(null);
              setRootDropActive(false);
            }}
            onContextMenu={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              setContextMenu({ kind: "folder", id: f.id, x: ev.clientX, y: ev.clientY });
            }}
            onClick={() => {
              if (isRenaming) return;
              setSelectedFolderId(f.id);
              toggleFolderExpanded(f.id);
            }}
            onMouseEnter={(ev) =>
              scheduleHoverMeta(
                {
                  kind: "folder",
                  id: f.id,
                  label: f.name,
                  folderCount: folderOptions.filter((x) => x.parent_id === f.id).length,
                  noteCount: notes.filter((n) => n.folder_id === f.id).length,
                },
                ev.clientX,
                ev.clientY,
              )
            }
            onMouseMove={(ev) => {
              setHoverMeta((prev) =>
                prev && prev.kind === "folder" && prev.id === f.id
                  ? { ...prev, x: ev.clientX, y: ev.clientY }
                  : prev,
              );
            }}
            onMouseLeave={clearHoverMeta}
            className={`group flex items-center gap-1 rounded py-1 pr-1 ${
              "hover:bg-black/5"
            } ${isDragging ? "opacity-40" : ""}`}
            style={{ paddingLeft: 4 + depth * 14 }}
          >
            <span
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-900/45"
              aria-hidden="true"
            >
              {expanded ? <IconChevronDown size={14} strokeWidth={2.6} /> : <IconChevronRight size={14} strokeWidth={2.6} />}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left">
              <span className="text-ink-900/55">
                {expanded ? <IconFolderOpen size={15} /> : <IconFolder size={15} />}
              </span>
              {isRenaming && renaming ? (
                <input
                  autoFocus
                  value={renaming.draft}
                  onChange={(ev) =>
                    setRenaming((prev) => (prev ? { ...prev, draft: ev.target.value } : prev))
                  }
                  onFocus={(ev) => ev.currentTarget.select()}
                  onClick={(ev) => ev.stopPropagation()}
                  onMouseDown={(ev) => ev.stopPropagation()}
                  onDragStart={(ev) => ev.stopPropagation()}
                  onBlur={() => void commitRename()}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") {
                      ev.preventDefault();
                      void commitRename();
                    } else if (ev.key === "Escape") {
                      ev.preventDefault();
                      cancelRename();
                    }
                  }}
                  className="h-5 min-w-0 flex-1 rounded border border-sky-400 bg-white px-1 text-[13px] outline-none"
                />
              ) : (
                <span className="truncate text-[14px] text-ink-900/85">{f.name}</span>
              )}
            </span>
            <span className="hidden gap-0.5 group-hover:flex">
              <button
                type="button"
                title="이 폴더에 새 노트"
                aria-label="이 폴더에 새 노트"
                onClick={(ev) => {
                  ev.stopPropagation();
                  void handleNewNoteIn(f.id);
                }}
                className="grid h-5 w-5 place-items-center rounded text-ink-900/55 hover:bg-black/10 hover:text-ink-900"
              >
                <IconFilePlus size={12} />
              </button>
              <button
                type="button"
                title="하위 폴더 추가"
                aria-label="하위 폴더 추가"
                onClick={(ev) => {
                  ev.stopPropagation();
                  beginCreateFolder(f.id);
                }}
                className="grid h-5 w-5 place-items-center rounded text-ink-900/55 hover:bg-black/10 hover:text-ink-900"
              >
                <IconFolderPlus size={12} />
              </button>
            </span>
          </div>
          <div
            className="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
            style={{
              gridTemplateRows: expanded ? "1fr" : "0fr",
              opacity: expanded ? 1 : 0.3,
            }}
          >
            <div className="min-h-0 overflow-hidden">
              <ul className="border-l border-ink-900/15" style={{ marginLeft: 14 + depth * 14 }}>
                {renderTreeItems(f.id, depth + 1)}
                {creatingFolder && creatingFolder.parentId === f.id ? (
                  <li className="list-none">
                    <div
                      className="flex items-center gap-1 rounded py-1 pr-1"
                      style={{ paddingLeft: 4 + (depth + 1) * 14 }}
                    >
                      <span className="grid h-5 w-5 shrink-0 place-items-center text-ink-900/45">
                        <IconChevronRight size={12} strokeWidth={2.6} />
                      </span>
                      <span className="text-ink-900/55">
                        <IconFolder size={14} />
                      </span>
                      <input
                        autoFocus
                        placeholder="새 폴더 이름"
                        value={creatingFolder.draft}
                        onChange={(ev) =>
                          setCreatingFolder((prev) =>
                            prev ? { ...prev, draft: ev.target.value } : prev,
                          )
                        }
                        onFocus={(ev) => ev.currentTarget.select()}
                        onBlur={() => void commitCreateFolder()}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") {
                            ev.preventDefault();
                            void commitCreateFolder();
                          } else if (ev.key === "Escape") {
                            ev.preventDefault();
                            cancelCreateFolder();
                          }
                        }}
                        className="h-5 min-w-0 flex-1 rounded border border-sky-400 bg-white px-1 text-[13px] outline-none"
                      />
                    </div>
                  </li>
                ) : null}
                {notesInFolder(f.id).map((n) => renderNoteRow(n, depth + 1))}
              </ul>
            </div>
          </div>
        </li>,
      );
    }
    return items;
  };

  const rootNotesNode = showTree ? notesInFolder(null) : [];

  const draggingNeedsRootLanding =
    !!draggedItem &&
    ((draggedItem.kind === "note" &&
      (notes.find((n) => n.id === draggedItem.id)?.folder_id ?? null) != null) ||
      (draggedItem.kind === "note-multi" &&
        draggedItem.ids.some((id) => (notes.find((n) => n.id === id)?.folder_id ?? null) != null)) ||
      (draggedItem.kind === "folder" &&
        (folderOptions.find((x) => x.id === draggedItem.id)?.parent_id ?? null) != null));

  const sidebarCard = (
    <aside className="flex h-full min-w-0 flex-col border-r border-ink-900/10 bg-[#f7f7f6] text-ink-900/80">
      <div className="border-b border-ink-900/10 px-2 py-2">
        <div className="relative">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-900/40">
            <IconSearch size={14} />
          </span>
          <input
            ref={searchInputRef}
            placeholder="검색 (#태그 + 텍스트)"
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            className="h-9 w-full rounded border border-ink-900/12 bg-white/70 pl-8 pr-2 text-[14px] outline-none focus:border-sky-500"
          />
          {activeSearchTagToken !== null && tagAutocomplete.length > 0 ? (
            <div className="absolute left-0 right-0 z-20 mt-1 rounded-md border border-ink-900/15 bg-white p-1 shadow-lg">
              {tagAutocomplete.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="block w-full rounded px-2 py-1 text-left text-[12px] text-ink-900/80 hover:bg-black/5"
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    applyTagAutocomplete(tag.name);
                  }}
                >
                  #{tag.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <header className="flex h-9 items-center justify-between border-b border-ink-900/10 px-3">
        <span className="text-[14px] font-semibold tracking-tight text-ink-900">
          {mode === "favorite" ? "즐겨찾기" : mode === "archive" ? "아카이브" : "전체 노트"}
        </span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            disabled={folderOptions.length === 0}
            onClick={toggleExpandAllFolders}
            title={allFoldersExpanded ? "모든 폴더 접기" : "모든 폴더 펼치기"}
            aria-label={allFoldersExpanded ? "모든 폴더 접기" : "모든 폴더 펼치기"}
            className="grid h-7 w-7 place-items-center rounded text-ink-900/55 hover:bg-black/5 hover:text-ink-900 disabled:opacity-30"
          >
            {allFoldersExpanded ? (
              <IconChevronDown size={16} strokeWidth={2.6} />
            ) : (
              <IconChevronRight size={16} strokeWidth={2.6} />
            )}
          </button>
          <button
            type="button"
            onClick={() => beginCreateFolder(null)}
            title="새 폴더"
            aria-label="새 폴더"
            className="grid h-7 w-7 place-items-center rounded text-ink-900/55 hover:bg-black/5 hover:text-ink-900 disabled:opacity-30"
          >
            <IconFolderPlus size={16} />
          </button>
          <button
            type="button"
            disabled={debouncedQuery.length >= 1}
            onClick={() => void handleNewNoteIn(null)}
            title="새 노트"
            aria-label="새 노트"
            className="grid h-7 w-7 place-items-center rounded text-ink-900/55 hover:bg-black/5 hover:text-ink-900 disabled:opacity-30"
          >
            <IconFilePlus size={16} />
          </button>
        </span>
      </header>

      <ul
        className={`scrollbar-subtle flex-1 overflow-y-auto px-1 py-1 ${
          rootDropActive && draggedItem ? "bg-sky-50/60" : ""
        }`}
        onContextMenu={(ev) => {
          ev.preventDefault();
          setContextMenu({ kind: "blank", x: ev.clientX, y: ev.clientY });
        }}
        onDragOver={(ev) => {
          const mime =
            dndHasMime(ev.dataTransfer, DND_MIME_NOTE) ||
            dndHasMime(ev.dataTransfer, DND_MIME_NOTE_MULTI) ||
            dndHasMime(ev.dataTransfer, DND_MIME_FOLDER);
          if (!mime && !draggedItemRef.current) return;
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "move";
          setRootDropActive(true);
        }}
        onDragLeave={(ev) => {
          const next = ev.relatedTarget as Node | null;
          if (!next || !(ev.currentTarget as HTMLElement).contains(next)) {
            setRootDropActive(false);
          }
        }}
        onDrop={(ev) => {
          ev.preventDefault();
          setRootDropActive(false);
          const ghost = draggedItemRef.current;
          const plain = ev.dataTransfer.getData("text/plain").trim();
          const multiRaw = ev.dataTransfer.getData(DND_MIME_NOTE_MULTI);
          let nid = ev.dataTransfer.getData(DND_MIME_NOTE);
          let fid = ev.dataTransfer.getData(DND_MIME_FOLDER);
          let multi: string[] = [];
          if (multiRaw) {
            try {
              const parsed = JSON.parse(multiRaw);
              if (Array.isArray(parsed)) multi = parsed.filter((x): x is string => typeof x === "string");
            } catch {}
          }
          if (!fid && !nid && plain) {
            if (notes.some((x) => x.id === plain)) nid = plain;
            else if (folderOptions.some((x) => x.id === plain)) fid = plain;
          }
          draggedItemRef.current = null;
          setDraggedItem(null);
          setFolderDropHoverId(null);
          if (multi.length >= 2) {
            void handleMoveNotesToFolder(multi, null);
          } else if (nid) {
            void handleMoveNoteToFolder(nid, null);
          } else if (fid) {
            void handleMoveFolderToParent(fid, null);
          } else if (ghost?.kind === "note") {
            void handleMoveNoteToFolder(ghost.id, null);
          } else if (ghost?.kind === "note-multi") {
            void handleMoveNotesToFolder(ghost.ids, null);
          } else if (ghost?.kind === "folder") {
            void handleMoveFolderToParent(ghost.id, null);
          }
        }}
      >
        {showTree ? (
          <>
            {draggingNeedsRootLanding ? (
              <li className="list-none sticky top-0 z-[5] px-1 pb-1 pt-0.5">
                <div
                  onDragOver={(ev) => {
                    const mime =
                      dndHasMime(ev.dataTransfer, DND_MIME_NOTE) ||
                      dndHasMime(ev.dataTransfer, DND_MIME_NOTE_MULTI) ||
                      dndHasMime(ev.dataTransfer, DND_MIME_FOLDER);
                    if (!mime && !draggedItemRef.current) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.dataTransfer.dropEffect = "move";
                    setRootDropActive(true);
                  }}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    setRootDropActive(false);
                    const ghost = draggedItemRef.current;
                    const plain = ev.dataTransfer.getData("text/plain").trim();
                    const multiRaw = ev.dataTransfer.getData(DND_MIME_NOTE_MULTI);
                    let nid = ev.dataTransfer.getData(DND_MIME_NOTE);
                    let fid = ev.dataTransfer.getData(DND_MIME_FOLDER);
                    let multi: string[] = [];
                    if (multiRaw) {
                      try {
                        const parsed = JSON.parse(multiRaw);
                        if (Array.isArray(parsed)) multi = parsed.filter((x): x is string => typeof x === "string");
                      } catch {}
                    }
                    if (!fid && !nid && plain) {
                      if (notes.some((x) => x.id === plain)) nid = plain;
                      else if (folderOptions.some((x) => x.id === plain)) fid = plain;
                    }
                    draggedItemRef.current = null;
                    setDraggedItem(null);
                    setFolderDropHoverId(null);
                    if (multi.length >= 2) void handleMoveNotesToFolder(multi, null);
                    else if (nid) void handleMoveNoteToFolder(nid, null);
                    else if (fid) void handleMoveFolderToParent(fid, null);
                    else if (ghost?.kind === "note") void handleMoveNoteToFolder(ghost.id, null);
                    else if (ghost?.kind === "note-multi") void handleMoveNotesToFolder(ghost.ids, null);
                    else if (ghost?.kind === "folder") void handleMoveFolderToParent(ghost.id, null);
                  }}
                  className={`rounded border border-dashed px-2 py-1.5 text-center text-[11px] text-ink-900/60 ${
                    rootDropActive ? "border-sky-500 bg-sky-100/90" : "border-ink-900/20 bg-white/50"
                  }`}
                >
                  루트로 이동 — 여기에 놓기
                </div>
              </li>
            ) : null}
            {renderTreeItems(null, 0)}
            {creatingFolder && creatingFolder.parentId === null ? (
              <li className="list-none">
                <div
                  className="flex items-center gap-1 rounded py-1 pr-1"
                  style={{ paddingLeft: 4 }}
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center text-ink-900/45">
                    <IconChevronRight size={12} />
                  </span>
                  <span className="text-ink-900/55">
                    <IconFolder size={14} />
                  </span>
                  <input
                    autoFocus
                    placeholder="새 폴더 이름"
                    value={creatingFolder.draft}
                    onChange={(ev) =>
                      setCreatingFolder((prev) =>
                        prev ? { ...prev, draft: ev.target.value } : prev,
                      )
                    }
                    onFocus={(ev) => ev.currentTarget.select()}
                    onBlur={() => void commitCreateFolder()}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") {
                        ev.preventDefault();
                        void commitCreateFolder();
                      } else if (ev.key === "Escape") {
                        ev.preventDefault();
                        cancelCreateFolder();
                      }
                    }}
                    className="h-5 min-w-0 flex-1 rounded border border-sky-400 bg-white px-1 text-[13px] outline-none"
                  />
                </div>
              </li>
            ) : null}
            {rootNotesNode.map((n) => renderNoteRow(n, 0))}
            {folderOptions.length === 0 && rootNotesNode.length === 0 && !creatingFolder ? (
              <li className="list-none px-3 py-8 text-center text-[13px] text-ink-900/45">
                폴더와 노트가 없습니다.
              </li>
            ) : null}
          </>
        ) : (
          <>
            {notes.length === 0 ? (
              <li className="list-none px-3 py-8 text-center text-[13px] text-ink-900/45">
                표시할 노트가 없습니다.
              </li>
            ) : null}
            {notes
              .slice()
              .sort(
                (a, b) =>
                  compareName(a.title || "", b.title || "") || a.id.localeCompare(b.id),
              )
              .map((n) => renderNoteRow(n, 0))}
          </>
        )}
      </ul>

      <footer className="flex items-center justify-between border-t border-ink-900/10 px-3 py-1.5 text-[11px] text-ink-900/45">
        <span>{usage ? formatBytes(usage.total_bytes) : "저장소"}</span>
        <button type="button" className="hover:text-ink-900" onClick={handleExport}>
          export
        </button>
      </footer>
    </aside>
  );

  let editorCard: ReactElement;
  if (!activeNote) {
    editorCard = (
      <section className="grid h-full place-items-center px-6 py-12 text-center">
        <div className="max-w-sm space-y-3 rounded-2xl bg-white p-8 shadow-pane ring-1 ring-ink-900/10">
          <p className="text-xs uppercase tracking-[0.3em] text-ink-900/35">시작</p>
          <p className="text-lg font-semibold text-ink-900">메모를 선택하거나 새로 만들어 보세요.</p>
          <p className="text-sm text-ink-900/60">사이드바에서 폴더·태그를 정리하면 흐름이 유지됩니다.</p>
          <button type="button" className="rounded-full bg-ink-900 px-5 py-2 text-sm font-semibold text-white" onClick={handleNewNote}>
            새 노트 만들기
          </button>
        </div>
      </section>
    );
  } else if (activeNote.deleted_at) {
    editorCard = (
      <section className="flex h-full items-center justify-center p-10 text-center text-sm text-ink-900/65">
        <div className="max-w-xs space-y-3 rounded-2xl bg-white p-8 shadow-pane ring-1 ring-ink-900/10">
          <p>이 노트는 휴지통에 있습니다. 내용은 유지되지만 편집하려면 복원해야 합니다.</p>
          <button
            type="button"
            className="rounded-full bg-emerald-600 px-5 py-2 text-xs font-semibold text-white shadow"
            onClick={() => void restoreActiveNote()}
          >
            복원하고 편집
          </button>
        </div>
      </section>
    );
  } else {
    editorCard = (
      <section className="flex h-full min-h-0 flex-col bg-white">
        {/* 옵시디언풍 작은 메타 툴바 */}
        <div className="flex h-9 items-center gap-2 border-b border-ink-900/10 bg-[#fafaf9] px-3 text-[12px] text-ink-900/65">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              saveState === "dirty"
                ? "bg-amber-100 text-amber-800"
                : saveState === "saving"
                  ? "bg-sky-100 text-sky-900"
                  : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {saveState === "dirty" ? "편집 중" : saveState === "saving" ? "저장 중" : "저장됨"}
          </span>
          <select
            value={activeNote.folder_id ?? ""}
            onChange={handleMoveNoteFolder}
            aria-label="폴더 배치"
            className="h-6 rounded border border-ink-900/12 bg-white/70 px-1 text-[12px]"
          >
            <option value="">루트</option>
            {folderOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void toggleFavorite()}
            title="즐겨찾기"
            aria-label="즐겨찾기 토글"
            className={`grid h-7 w-7 place-items-center rounded ${
              activeNote.is_favorite ? "bg-black/10 text-ink-900" : "hover:bg-black/5 hover:text-ink-900"
            }`}
          >
            <IconStar size={15} filled={activeNote.is_favorite} />
          </button>
          <button
            type="button"
            onClick={() => void toggleArchive()}
            title="아카이브"
            aria-label="아카이브 토글"
            className={`grid h-7 w-7 place-items-center rounded ${
              activeNote.is_archived ? "bg-black/10 text-ink-900" : "hover:bg-black/5 hover:text-ink-900"
            }`}
          >
            <IconArchive size={15} />
          </button>
          <button
            type="button"
            onClick={() => void handleManualSnapshot()}
            title="체크포인트"
            aria-label="체크포인트 저장"
            className="grid h-7 w-7 place-items-center rounded hover:bg-black/5 hover:text-ink-900"
          >
            <IconSave size={15} />
          </button>
          <button
            type="button"
            onClick={() => void handleListItemAction({ ...activeNote, tags: activeNote.tags })}
            title="휴지통으로 이동"
            aria-label="휴지통으로 이동"
            className="grid h-7 w-7 place-items-center rounded hover:bg-black/5 hover:text-ink-900"
          >
            <IconTrash size={15} />
          </button>

          <div className="ml-auto flex items-center gap-1">
            {/* 본문에 미디어 인라인 삽입: 이미지 / 음성 녹음 / 오디오 / 파일 */}
            <label
              title="이미지 본문에 삽입"
              aria-label="이미지 본문에 삽입"
              className="grid h-7 w-7 cursor-pointer place-items-center rounded hover:bg-black/5 hover:text-ink-900"
            >
              <IconImage size={15} />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  ev.target.value = "";
                  if (f) void uploadAndInsert(f);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => (isRecording ? stopAudioRecording() : void startAudioRecording())}
              title={isRecording ? "녹음 종료" : "음성 녹음 시작"}
              aria-label={isRecording ? "녹음 종료" : "음성 녹음 시작"}
              className={`grid h-7 w-7 place-items-center rounded ${
                isRecording ? "bg-red-500 text-white animate-pulse" : "hover:bg-black/5 hover:text-ink-900"
              }`}
            >
              {isRecording ? <IconStop size={15} /> : <IconMic size={15} />}
            </button>
            <label
              title="오디오 파일 본문에 삽입"
              aria-label="오디오 파일 본문에 삽입"
              className="grid h-7 w-7 cursor-pointer place-items-center rounded hover:bg-black/5 hover:text-ink-900"
            >
              <IconMusic size={15} />
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  ev.target.value = "";
                  if (f) void uploadAndInsert(f);
                }}
              />
            </label>
            <label
              title="일반 파일 본문에 삽입"
              aria-label="일반 파일 본문에 삽입"
              className="grid h-7 w-7 cursor-pointer place-items-center rounded hover:bg-black/5 hover:text-ink-900"
            >
              <IconFile size={15} />
              <input
                type="file"
                className="hidden"
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  ev.target.value = "";
                  if (f) void uploadAndInsert(f);
                }}
              />
            </label>

            {/* 우측 패널 토글: 첨부 / 버전 */}
            <span className="mx-1 h-4 w-px bg-ink-900/10" aria-hidden="true" />
            <button
              type="button"
              onClick={() => setRightPanel(rightPanel === "files" ? null : "files")}
              title="첨부 파일"
              aria-label="첨부 파일 토글"
              className={`grid h-7 w-7 place-items-center rounded ${
                rightPanel === "files" ? "bg-black/10 text-ink-900" : "hover:bg-black/5 hover:text-ink-900"
              }`}
            >
              <IconPaperclip size={15} />
            </button>
            <button
              type="button"
              onClick={() => setRightPanel(rightPanel === "versions" ? null : "versions")}
              title="버전 히스토리"
              aria-label="버전 히스토리 토글"
              className={`grid h-7 w-7 place-items-center rounded ${
                rightPanel === "versions" ? "bg-black/10 text-ink-900" : "hover:bg-black/5 hover:text-ink-900"
              }`}
            >
              <IconClock size={15} />
            </button>
          </div>
        </div>

        {/* 본문 */}
        <main className="scrollbar-subtle flex-1 overflow-y-auto overflow-x-hidden px-6 py-6 md:px-10">
          <input
            ref={titleInputRef}
            className="mx-auto block w-full max-w-3xl border-0 bg-transparent px-0 py-2 text-3xl font-semibold tracking-tight text-ink-900 outline-none placeholder:text-ink-900/25 focus:ring-0"
            value={title}
            onChange={(ev) => {
              setTitle(ev.target.value);
              if (!composingRef.current) scheduleAutosave();
            }}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleTitleCompositionEnd}
            placeholder="제목"
          />

          {/* 태그 칩 행 (옵시디언 속성처럼 가볍게) */}
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-1.5 pb-4 pt-1 text-[12px] text-ink-900/55">
            {activeNote.tags.length === 0 ? (
              <span className="text-ink-900/30">태그 없음</span>
            ) : (
              activeNote.tags.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  onClick={() => void toggleTagForActive(tag, false)}
                  title="태그 해제"
                  className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-800 hover:bg-sky-100"
                >
                  #{tag.name}
                </button>
              ))
            )}
            <details className="relative">
              <summary className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-ink-900/45 hover:bg-black/5">
                + 태그
              </summary>
              <div className="absolute left-0 z-30 mt-1 w-56 rounded-md border border-ink-900/15 bg-white p-2 shadow-lg">
                <div className="flex max-h-48 flex-wrap gap-1 overflow-auto">
                  {tags.length === 0 ? (
                    <p className="text-[11px] text-ink-900/45">먼저 사이드바에서 태그를 만드세요.</p>
                  ) : (
                    tags.map((tag) => {
                      const on = !!activeNote.tags.find((x) => x.id === tag.id);
                      return (
                        <button
                          type="button"
                          key={tag.id}
                          onClick={() => void toggleTagForActive(tag, !on)}
                          className={`rounded px-1.5 py-0.5 text-[11px] ${
                            on ? "bg-ink-900 text-white" : "bg-black/5 text-ink-900/65 hover:bg-black/10"
                          }`}
                        >
                          #{tag.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </details>
          </div>

          <section className="mx-auto w-full max-w-3xl min-h-[62dvh] py-2">
            <CodeMirror
              value={content}
              height="auto"
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                dropCursor: true,
                searchKeymap: true,
              }}
              extensions={[
                markdown({ base: markdownLanguage, codeLanguages: languages }),
                hybridMarkdownField,
                EditorView.lineWrapping,
                cmEditorVisualTheme,
                editorMouseHandlers,
              ]}
              placeholder="내용은 Markdown 스타일로 자유롭게 작성하세요. 자동 저장이 켜져 있습니다."
              onCreateEditor={(view) => {
                editorViewRef.current = view;
                setEditorReady(true);
              }}
              onChange={(value) => {
                setContent(value);
                if (!composingRef.current) scheduleAutosave();
              }}
              className="[&_.cm-editor]:border-0 [&_.cm-editor]:bg-transparent [&_.cm-editor]:font-inherit [&_.cm-scroller]:text-[15px] [&_.cm-scroller]:leading-6 [&_.cm-content]:min-h-[58dvh] [&_.cm-content]:px-0 [&_.cm-content]:py-1"
            />
          </section>
        </main>
      </section>
    );
  }

  // ---------- 우측 토글 패널: 첨부 / 버전 ----------
  const rightPanelCard =
    activeNote && !activeNote.deleted_at && rightPanel ? (
      <aside className="flex h-full min-w-0 flex-col border-l border-ink-900/10 bg-[#fafaf9]">
        <header className="flex h-9 items-center gap-1 border-b border-ink-900/10 px-2 text-[12px]">
          <button
            type="button"
            onClick={() => setRightPanel("files")}
            className={`rounded px-2 py-0.5 ${rightPanel === "files" ? "bg-black/10 text-ink-900" : "text-ink-900/55 hover:bg-black/5"}`}
          >
            첨부
          </button>
          <button
            type="button"
            onClick={() => setRightPanel("versions")}
            className={`rounded px-2 py-0.5 ${rightPanel === "versions" ? "bg-black/10 text-ink-900" : "text-ink-900/55 hover:bg-black/5"}`}
          >
            버전
          </button>
          <button
            type="button"
            onClick={() => setRightPanel(null)}
            title="패널 닫기"
            aria-label="패널 닫기"
            className="ml-auto grid h-7 w-7 place-items-center rounded text-ink-900/55 hover:bg-black/5 hover:text-ink-900"
          >
            <IconX size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3 text-[13px]">
          {rightPanel === "files" ? (
            <div className="space-y-3">
              <label className="block w-full cursor-pointer rounded border border-dashed border-ink-900/20 bg-white/50 px-3 py-2 text-center text-[12px] text-ink-900/60 hover:bg-white">
                파일 업로드
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(ev) => void handleUpload(ev.target.files)}
                />
              </label>
              {(() => {
                const liveAttachments = activeNote.attachments.filter((a) => !a.deleted_at);
                if (liveAttachments.length === 0) {
                  return (
                    <p className="text-[12px] text-ink-900/45">
                      첨부가 없습니다. 이미지·오디오·일반 파일 모두 가능합니다.
                    </p>
                  );
                }
                return liveAttachments.map((att) => (
                  <div key={att.id} className="rounded border border-ink-900/12 bg-white p-2">
                    {att.kind === "image" ? (
                      <AuthenticatedImagePreview
                        attachmentId={att.id}
                        token={token}
                        caption={att.original_filename}
                      />
                    ) : (
                      <p className="text-[12px] text-ink-900/70">
                        <span className="font-mono">[{att.kind}]</span> {att.original_filename} ·{" "}
                        {formatBytes(att.size_bytes)}
                      </p>
                    )}
                    <button
                      type="button"
                      className="mt-2 w-full rounded border border-amber-200 px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-50"
                      onClick={() => void handleTrashAttachment(att)}
                    >
                      제거
                    </button>
                  </div>
                ));
              })()}
            </div>
          ) : (
            <div className="space-y-2">
              {versions.length === 0 ? (
                <p className="text-[12px] text-ink-900/45">아직 저장된 버전이 없습니다.</p>
              ) : (
                versions.slice(0, 32).map((v) => (
                  <article key={v.id} className="rounded border border-ink-900/12 bg-white px-2 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[12px] font-semibold text-ink-900">#{v.version_index}</p>
                        <p className="text-[11px] text-ink-900/55">
                          {new Date(v.created_at).toLocaleString()}
                        </p>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-ink-900/45">
                          {REASON_LABEL[v.reason] ?? v.reason}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-sky-700"
                        onClick={() => void handleRestoreVersion(v)}
                      >
                        되돌리기
                      </button>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12px] text-ink-900/65">{v.title}</p>
                  </article>
                ))
              )}
            </div>
          )}
        </div>
      </aside>
    ) : null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white">
      {error ? (
        <div className="border-b border-amber-400/40 bg-amber-50 px-4 py-2 text-[13px] text-amber-900">
          ⚠️ {error}
          <button type="button" className="float-right ml-4 text-[11px] font-semibold" onClick={() => setError(null)}>
            숨김
          </button>
        </div>
      ) : null}

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

        <div className="hidden">
          <div className={`${panel === "nav" ? "flex flex-1" : "hidden"} bg-[#fcfcfb]`}>{navCard}</div>
          <div className={`${panel === "list" ? "flex flex-1" : "hidden"} bg-[#f7f8fb]`}>{listCard}</div>
          <div className={`${panel === "editor" ? "flex flex-1 bg-white" : "hidden"} flex-col overflow-hidden`}>{editorCard}</div>
        </div>

        {/* 모바일 전용 FAB: '목록' 패널에서만 노출 (에디터 본문을 가리지 않게) */}
        {panel === "list" ? (
          <button
            type="button"
            aria-label="새 노트"
            onClick={handleNewNote}
            className="hidden"
          >
            +
          </button>
        ) : null}

        {/* 폴더/노트/빈 영역 우클릭 컨텍스트 메뉴 */}
        {contextMenu ? (
          <div
            id="tree-context-menu"
            className="fixed z-50 min-w-[180px] overflow-hidden rounded-md border border-ink-900/15 bg-white py-1 text-[13px] shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.kind === "blank" ? (
              <>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left hover:bg-black/5"
                  onClick={() => {
                    setContextMenu(null);
                    void handleNewNoteIn(null);
                  }}
                >
                  새 노트
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left hover:bg-black/5"
                  onClick={() => {
                    setContextMenu(null);
                    beginCreateFolder(null);
                  }}
                >
                  새 폴더
                </button>
              </>
            ) : contextMenu.kind === "folder" ? (
              <>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left hover:bg-black/5"
                  onClick={() => {
                    const target = contextMenu;
                    setContextMenu(null);
                    void handleNewNoteIn(target.id);
                  }}
                >
                  이 폴더에 새 노트
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left hover:bg-black/5"
                  onClick={() => {
                    const target = contextMenu;
                    setContextMenu(null);
                    beginCreateFolder(target.id);
                  }}
                >
                  새 하위 폴더
                </button>
                <div className="my-1 h-px bg-ink-900/10" />
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left hover:bg-black/5"
                  onClick={() => {
                    const target = contextMenu;
                    setContextMenu(null);
                    beginRename("folder", target.id);
                  }}
                >
                  이름 변경
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
                  onClick={() => {
                    const target = contextMenu;
                    setContextMenu(null);
                    void handleDeleteFolder(target.id);
                  }}
                >
                  폴더 삭제
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left hover:bg-black/5"
                  onClick={() => {
                    const target = contextMenu;
                    setContextMenu(null);
                    beginRename("note", target.id);
                  }}
                >
                  이름 변경
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
                  onClick={() => {
                    const target = contextMenu;
                    setContextMenu(null);
                    void handleNoteContextDelete(target.id);
                  }}
                >
                  삭제
                </button>
              </>
            )}
          </div>
        ) : null}

        {hoverMeta ? (
          <div
            className="pointer-events-none fixed z-[60] max-w-[280px] rounded-md border border-ink-900/20 bg-white/95 px-2.5 py-2 text-[12px] text-ink-900 shadow-lg backdrop-blur"
            style={{ left: hoverMeta.x + 14, top: hoverMeta.y + 14 }}
          >
            <p className="mb-1 truncate font-semibold">{hoverMeta.label}</p>
            {hoverMeta.kind === "folder" ? (
              <>
                <p className="text-ink-900/70">하위 폴더: {hoverMeta.folderCount ?? 0}개</p>
                <p className="text-ink-900/70">파일: {hoverMeta.noteCount ?? 0}개</p>
              </>
            ) : (
              <>
                <p className="text-ink-900/70">생성: {formatDateTime(hoverMeta.createdAt)}</p>
                <p className="text-ink-900/70">수정: {formatDateTime(hoverMeta.updatedAt)}</p>
              </>
            )}
          </div>
        ) : null}

        {confirmDialog ? (
          <div className="fixed inset-0 z-[80] grid place-items-center bg-black/30 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl ring-1 ring-ink-900/15">
              <h3 className="text-[15px] font-semibold text-ink-900">{confirmDialog.title}</h3>
              <p className="mt-2 whitespace-pre-line text-[13px] text-ink-900/75">
                {confirmDialog.message}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md border border-ink-900/20 px-3 py-1.5 text-[12px] text-ink-900/75 hover:bg-black/5"
                  onClick={() => closeConfirm(false)}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="rounded-md bg-red-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-red-700"
                  onClick={() => closeConfirm(true)}
                >
                  {confirmDialog.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <nav className="hidden">
        <div className="mx-auto grid max-w-md grid-cols-3 gap-1 text-xs font-semibold text-ink-900/65">
          {(
            [
              ["nav", "정리"],
              ["list", "목록"],
              ["editor", "편집"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`min-h-[44px] rounded-full py-2 transition ${panel === key ? "bg-ink-900 text-white" : "bg-ink-900/5"}`}
              onClick={() => setPanel(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

