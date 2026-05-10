"use client";

import { useRouter } from "next/navigation";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";
import {
  IconArchive,
  IconBrush,
  IconClock,
  IconEraser,
  IconFile,
  IconHighlighter,
  IconImage,
  IconList,
  IconLogOut,
  IconMic,
  IconMusic,
  IconPaperclip,
  IconPlus,
  IconRedo,
  IconSave,
  IconSidebarToggle,
  IconStar,
  IconStop,
  IconTrash,
  IconUndo,
  IconX,
} from "./Icons";
import { AuthenticatedImagePreview } from "./AuthenticatedImagePreview";
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
  getLastDocCursor,
  hybridMarkdownField,
  isLastDocCursorExplicit,
  resetLastDocCursor,
  setEditorAuthContext,
  setEditorInsertFile,
  setEditorNavigateLink,
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
  OverlayStroke,
  StorageUsage,
  Tag,
} from "@/lib/api";
import { ApiError, api } from "@/lib/api";
import {
  OverlayDrawingLayer,
  type OverlayDrawingLayerHandle,
  type OverlayDrawingTool,
} from "./OverlayDrawingLayer";
import { parseChecklistLine } from "./markdown";
import type {
  AppCommand,
  ConfirmDialogState,
  ContextMenuTarget,
  CreatingFolderState,
  DragItem,
  HoverMeta,
  Panel,
  ListMode,
  RenamingState,
  SelectionAnchor,
  TodoPanelItem,
  SlashMenuState,
} from "./workbenchTypes";
import { overlaySignature, todayNoteTitle, extractTodoItems } from "./workbenchHelpers";
import { CommandPalette } from "./CommandPalette";
import { ConfirmDialog, ContextMenu, HoverTooltip } from "./WorkbenchOverlays";
import { WorkbenchSidebar } from "./WorkbenchSidebar";
import { wikilinkAutocompleteExtension } from "./wikilinkExtension";

// (REASON_LABEL, formatBytes, formatDateTime, compareName, DND 상수, dndHasMime 은 ./utils 로 이동)
// (escapeHtml 등 마크다운 렌더링은 ./markdown 으로 이동)
// (CodeMirror 위젯/상태/테마/이벤트 핸들러는 ./editor 로 이동)
// (Panel/ListMode/TodoPanelItem/SlashMenuState 등 타입은 ./workbenchTypes 로 이동)
// (overlaySignature/todayNoteTitle/extractTodoItems 헬퍼는 ./workbenchHelpers 로 이동)
// (위키링크 자동완성은 ./wikilinkExtension 의 CodeMirror autocomplete 확장으로 이동)

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
  // 데스크탑 우측 토글 패널: 평소엔 닫혀있고 버튼으로 파일/버전/할 일 중 하나 표시
  const [rightPanel, setRightPanel] = useState<"files" | "versions" | "todos" | null>(null);
  const [todoItems, setTodoItems] = useState<TodoPanelItem[]>([]);
  const [todoLoading, setTodoLoading] = useState(false);
  // 옵시디언풍 폴더 트리: 어떤 폴더가 펼쳐져 있는지
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  // 우클릭 컨텍스트 메뉴 (폴더 / 노트 / 빈 영역) — 타입은 ./workbenchTypes 로 이동.
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  // 인라인 이름 편집 (폴더 / 노트 통합)
  const [renaming, setRenaming] = useState<
    { kind: "folder" | "note"; id: string; draft: string } | null
  >(null);
  // 인라인 새 폴더 생성 (parentId=null이면 루트)
  const [creatingFolder, setCreatingFolder] = useState<
    { parentId: string | null; draft: string } | null
  >(null);
  // 드래그 앤 드롭: 끌고 있는 항목 (DragItem 타입은 ./workbenchTypes 로 이동)
  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null);
  // setState는 비동기라 dragstart 직후 첫 dragover에서 state가 stale.
  // ref로 즉시 동기 업데이트해서 dragover/drop은 ref를 본다.
  const draggedItemRef = useRef<DragItem | null>(null);
  // 드래그하여 폴더 row 위에 호버 중인 타깃 폴더 ID (폴더 안으로 이동만 — 형제 순서 변경 없음)
  const [folderDropHoverId, setFolderDropHoverId] = useState<string | null>(null);
  // 사이드바 헤더(루트) 드롭 활성화 표시
  const [rootDropActive, setRootDropActive] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);
  // HoverMeta 타입은 ./workbenchTypes 로 이동.
  const [hoverMeta, setHoverMeta] = useState<HoverMeta | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  // 노트 다중 선택(사이드바): 같은 folder_id 위계에서 Shift 범위 선택 지원
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const selectionAnchorRef = useRef<SelectionAnchor>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 에디터 제목 input ref — 새 노트 직후 포커스
  const titleInputRef = useRef<HTMLInputElement>(null);
  /** create 직후 해당 노트가 마운트되면 제목으로 포커스 (useLayoutEffect에서 소비) */
  const pendingFocusNewNoteRef = useRef<string | null>(null);

  const saveTimerRef = useRef<number | null>(null);
  const lastSentRef = useRef<{ title: string; content: string; overlayKey: string }>({
    title: "",
    content: "",
    overlayKey: "",
  });
  // 본문 위 자유 그림 레이어 상태. activeNote.overlay_strokes 와 양방향 동기.
  const [overlayStrokes, setOverlayStrokes] = useState<OverlayStroke[]>([]);
  const [drawingMode, setDrawingMode] = useState(false);
  const [drawingTool, setDrawingTool] = useState<OverlayDrawingTool>("pen");
  const [drawingColor, setDrawingColor] = useState("#1f2937");
  const [drawingWidth, setDrawingWidth] = useState(2.5);
  const overlayHandleRef = useRef<OverlayDrawingLayerHandle | null>(null);
  // 그림 레이어 자동 저장 타이머 (본문/제목과 별개의 디바운스)
  const overlayTimerRef = useRef<number | null>(null);
  // CodeMirror EditorView — onCreateEditor 에서 채워짐. 첨부 마커 삽입에 사용.
  const editorViewRef = useRef<EditorView | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [slashMenu, setSlashMenu] = useState<SlashMenuState>(null);
  // 슬래시 메뉴에서 키보드/호버로 선택 중인 항목 인덱스. 메뉴가 열려 있는 동안만 의미 있음.
  const [slashSelected, setSlashSelected] = useState(0);
  // 슬래시 메뉴 업데이트 함수의 최신 closure 를 CodeMirror 확장에서 호출하기 위한 ref.
  // (React onChange 에만 의존하면 일부 입력에서 누락되는 케이스가 있어 직접 listener 로 옮긴다.)
  const updateSlashMenuRef = useRef<(view: EditorView) => void>(() => {});
  // 위키링크 자동완성은 ./wikilinkExtension 의 CodeMirror autocomplete 확장이
  // 직접 들고 있다. 메뉴 상태 / 키보드 선택 / DOM 좌표 추적 모두 CodeMirror 가
  // 관리하므로 React state 는 두지 않는다.
  // 새 노트를 만든 직후 제목 input 으로 포커스를 자동 이동시킬지.
  const [autoFocusTitle, setAutoFocusTitle] = useState(false);
  // 음성 녹음 상태
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
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
        // 노트가 바뀌면 이전 노트에서 두었던 캐럿 위치는 의미가 없다. 사용자가
        // 새 노트 본문에 클릭하기 전까지는 "명시적 캐럿 없음" 상태로 둔다.
        // 이렇게 안 하면 새 노트로 간 직후 툴바/드롭/붙여넣기로 첨부할 때
        // 이전 노트의 오프셋이 새 노트에 적용돼서 예상치 못한 위치(또는 0)에
        // 박히는 사고가 난다.
        resetLastDocCursor();
        const note = await api.getNote(token, id);
        setActiveNote(note);
        setTitle(note.title);
        setContent(note.content);
        const incomingOverlay = Array.isArray(note.overlay_strokes) ? note.overlay_strokes : [];
        setOverlayStrokes(incomingOverlay);
        // 다른 노트로 옮기면 그리기 모드는 해제 (실수로 새 노트에 그리는 것 방지).
        setDrawingMode(false);
        lastSentRef.current = {
          title: note.title,
          content: note.content,
          overlayKey: overlaySignature(incomingOverlay),
        };
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
        lastSentRef.current = {
          title,
          content,
          overlayKey: overlaySignature(updated.overlay_strokes ?? []),
        };
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

  // 그림 레이어 stroke 가 바뀌면 디바운스 후 서버로 패치한다. 본문 자동 저장과
  // 분리해서 텍스트 편집과 그림이 서로의 디바운스를 깨지 않게 한다.
  useEffect(() => {
    if (!activeNoteId || !activeNote || activeNote.deleted_at) return;
    const sig = overlaySignature(overlayStrokes);
    if (sig === lastSentRef.current.overlayKey) return;
    if (overlayTimerRef.current) window.clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = window.setTimeout(async () => {
      overlayTimerRef.current = null;
      try {
        const updated = await api.patchNote(token, activeNoteId, {
          overlay_strokes: overlayStrokes,
        });
        lastSentRef.current = {
          ...lastSentRef.current,
          overlayKey: overlaySignature(updated.overlay_strokes ?? []),
        };
        // overlay_strokes 만 갱신된 응답으로 activeNote 의 다른 필드를 덮어쓰면
        // 사용자가 그동안 입력한 title/content 가 사라질 수 있다. 메타만 갱신.
        setActiveNote((prev) => (prev ? { ...prev, overlay_strokes: updated.overlay_strokes } : prev));
      } catch (e) {
        handleApiError(e);
      }
    }, 700);
    return () => {
      if (overlayTimerRef.current) {
        window.clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
    };
  }, [overlayStrokes, activeNoteId, activeNote, token, handleApiError]);

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

  const refreshTodoItems = useCallback(async () => {
    if (!token) return;
    setTodoLoading(true);
    try {
      const rows = await api.listNotes(token, { archived: false, trash: false });
      const details = await Promise.all(rows.map((n) => api.getNote(token, n.id)));
      const items = details.flatMap((note) => {
        const sourceContent = activeNoteId === note.id ? content : note.content;
        const sourceTitle = activeNoteId === note.id ? title : note.title;
        return extractTodoItems({ id: note.id, title: sourceTitle }, sourceContent);
      });
      setTodoItems(items);
    } catch (e) {
      handleApiError(e);
    } finally {
      setTodoLoading(false);
    }
  }, [activeNoteId, content, handleApiError, title, token]);

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
        const updated = await api.patchNote(token, item.noteId, {
          content: nextContent,
          title: isActive ? title : note.title,
          tag_ids: note.tags.map((x) => x.id),
          folder_id: note.folder_id ?? null,
        });
        if (isActive) {
          setContent(nextContent);
          setActiveNote(updated);
          lastSentRef.current = {
            ...lastSentRef.current,
            title,
            content: nextContent,
          };
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
    [activeNote, activeNoteId, content, handleApiError, refreshTodoItems, reloadNotes, title, token],
  );

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

  // useLayoutEffect 가 놓치는 케이스(다른 컴포넌트가 await 사이에 포커스를 가져
  // 가버리는 등) 를 보강하기 위해, 새 노트를 만든 직후 호출자 쪽에서 한 번 더
  // 명시적으로 제목 input 에 캐럿을 넣어준다.
  // 새 노트 직후 제목 input 으로 캐럿을 옮긴다. 단순히 한두 번 focus() 를
  // 부르는 것만으로는 (CodeMirror 마운트, 자동저장, 다른 이펙트가 await 중간에
  // 끼면서) 포커스가 다시 빼앗기는 케이스가 잡힌다. 그래서 짧은 간격으로
  // 짧게 폴링하다가 input 이 실제로 활성 element 가 되면 멈춘다.
  function focusTitleSoon(): void {
    setAutoFocusTitle(true);
    let attempts = 0;
    const maxAttempts = 25; // ~1.5s at 60ms
    const tryFocus = () => {
      const el = titleInputRef.current;
      const before = document.activeElement;
      if (el && document.activeElement !== el) {
        try {
          el.focus({ preventScroll: true });
          el.select();
        } catch {
          /* noop */
        }
      }
      const after = document.activeElement;
      // eslint-disable-next-line no-console
      console.log("[title-focus]", {
        attempt: attempts,
        hasEl: !!el,
        beforeTag: before?.tagName,
        beforeCls: (before as HTMLElement | null)?.className?.slice?.(0, 60),
        afterTag: after?.tagName,
        afterCls: (after as HTMLElement | null)?.className?.slice?.(0, 60),
      });
      if (el && document.activeElement === el) {
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) {
        window.setTimeout(tryFocus, 60);
      }
    };
    requestAnimationFrame(tryFocus);
  }

  // autoFocusTitle 가 true 면, 활성 노트가 바뀔 때마다 title input 이 마운트되는
  // 첫 시점에 강제로 포커스를 잡는다. 한 번 포커스가 들어가면 플래그를 내린다.
  useEffect(() => {
    if (!autoFocusTitle) return;
    if (!activeNote || activeNote.deleted_at) return;
    const tryFocus = () => {
      const el = titleInputRef.current;
      if (!el) return false;
      el.focus({ preventScroll: true });
      try {
        el.select();
      } catch {
        /* noop */
      }
      return document.activeElement === el;
    };
    if (tryFocus()) {
      setAutoFocusTitle(false);
      return;
    }
    const id1 = window.requestAnimationFrame(() => {
      if (tryFocus()) setAutoFocusTitle(false);
    });
    const id2 = window.setTimeout(() => {
      if (tryFocus()) setAutoFocusTitle(false);
    }, 80);
    const id3 = window.setTimeout(() => {
      tryFocus();
      setAutoFocusTitle(false);
    }, 240);
    return () => {
      window.cancelAnimationFrame(id1);
      window.clearTimeout(id2);
      window.clearTimeout(id3);
    };
  }, [autoFocusTitle, activeNote?.id]);

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
      focusTitleSoon();
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
      focusTitleSoon();
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
      pendingFocusNewNoteRef.current = draft.id;
      await reloadNotes();
      await loadNote(draft.id);
      focusTitleSoon();
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
  //
  // 캐럿 위치 결정 규칙(아래 우선순위):
  //   1) 본문에 포커스가 살아 있으면 view.state.selection 을 그대로 쓴다.
  //      (=화면에서 깜빡이는 캐럿)
  //   2) 본문에서 한 번이라도 사용자가 명시적으로 캐럿을 둔 적이 있으면
  //      그 마지막 위치(__lastDocCursor) 를 쓴다.
  //   3) 위 두 조건 다 아니면(예: 새 노트 열자마자 툴바 버튼만 누른 경우)
  //      문서 끝에 append. 예전엔 이 경우에도 0(=최상단) 으로 박혀버려서
  //      "이미지 위치가 항상 최상단" 처럼 보였음.
  function insertMarkerAtCursor(marker: string): boolean {
    const view = editorViewRef.current;
    if (!view) return false;
    const doc = view.state.doc;
    // 우선순위:
    //  1) 본문 포커스가 살아 있으면 화면에 보이는 캐럿(view.state.selection)이 곧 진실.
    //  2) 본문에서 명시적으로 캐럿을 둔 적이 있다면 그 마지막 위치.
    //  3) 사용자가 본문을 한 번도 안 만졌으면 문서 끝(append) — "최상단으로 박히는"
    //     예전 버그 재발 방지.
    let chosen: number;
    if (view.hasFocus) {
      chosen = view.state.selection.main.from;
    } else if (isLastDocCursorExplicit()) {
      chosen = getLastDocCursor();
    } else {
      chosen = doc.length;
    }
    chosen = Math.min(Math.max(0, chosen), doc.length);
    const baseFrom = chosen;
    const baseTo = chosen;
    const lineAtFrom = doc.lineAt(baseFrom);
    const atLineStart = baseFrom === lineAtFrom.from;
    const lineEmpty = lineAtFrom.text.trim().length === 0;
    let prefix = "";
    let suffix = "\n";
    if (!atLineStart) prefix = "\n";
    else if (!lineEmpty) prefix = "";
    const insertText = `${prefix}${marker}${suffix}`;
    view.dispatch({
      changes: { from: baseFrom, to: baseTo, insert: insertText },
      selection: { anchor: baseFrom + insertText.length },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }

  function insertTextAtCursor(insertText: string): boolean {
    const view = editorViewRef.current;
    if (!view) return false;
    const doc = view.state.doc;
    let chosen: number;
    if (view.hasFocus) {
      chosen = view.state.selection.main.from;
    } else if (isLastDocCursorExplicit()) {
      chosen = getLastDocCursor();
    } else {
      chosen = doc.length;
    }
    chosen = Math.min(Math.max(0, chosen), doc.length);
    view.dispatch({
      changes: { from: chosen, to: chosen, insert: insertText },
      selection: { anchor: chosen + insertText.length },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }

  function replaceSlashCommand(insertText: string): boolean {
    const view = editorViewRef.current;
    if (!view || !slashMenu) return insertTextAtCursor(insertText);
    // 클릭/Enter 시점에 view.state.selection 을 다시 읽으면, 일부 환경에서
    // 포커스 이동/이벤트 순서 때문에 selection 이 0 으로 초기화돼 본문 맨
    // 앞에 박혀버리는 사고가 난다. 그래서 메뉴를 열었을 때 잡아둔
    // slashMenu.from / slashMenu.to 를 그대로 신뢰해 사용한다.
    const docLen = view.state.doc.length;
    const from = Math.min(Math.max(0, slashMenu.from), docLen);
    const to = Math.min(Math.max(from, slashMenu.to), docLen);
    view.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: from + insertText.length },
      scrollIntoView: true,
    });
    // 실행 직후 무조건 메뉴 닫기. 같은 update 사이클에서 listener 가 다시
    // 발동해 재오픈되는 걸 막기 위해 setSlashMenu 도 즉시 호출한다.
    setSlashMenu(null);
    setSlashSelected(0);
    // setSlashMenu state flush 후 포커스를 잡아 다음 keydown 이 본문으로 들어가게.
    requestAnimationFrame(() => view.focus());
    return true;
  }

  function updateSlashMenuFromView(view: EditorView): void {
    const sel = view.state.selection.main;
    if (!sel.empty) {
      setSlashMenu((prev) => (prev === null ? prev : null));
      return;
    }
    const line = view.state.doc.lineAt(sel.head);
    const beforeCursor = line.text.slice(0, sel.head - line.from);
    const match = beforeCursor.match(/(^|\s)\/([\w가-힣]*)$/);
    if (!match) {
      setSlashMenu((prev) => (prev === null ? prev : null));
      return;
    }
    const queryText = match[2] ?? "";
    const from = sel.head - queryText.length - 1;
    // 캐럿 픽셀 좌표를 잡아 메뉴를 바로 옆에 띄운다. coordsAtPos 가 null 이면
    // (마운트 직후/가상화) 화면 좌상단쯤으로 fallback.
    let x = 24;
    let y = 80;
    const cursorRect = view.coordsAtPos(sel.head);
    if (cursorRect) {
      x = cursorRect.left;
      y = cursorRect.bottom + 4;
    }
    setSlashMenu((prev) => {
      // 같은 위치/쿼리면 재할당하지 않아 무한 렌더 루프를 막는다. listener 가
      // reconfigure 등 비입력 update 에도 fire 되기 때문에 필수 가드.
      if (
        prev &&
        prev.from === from &&
        prev.to === sel.head &&
        prev.query === queryText &&
        prev.x === x &&
        prev.y === y
      ) {
        return prev;
      }
      return { from, to: sel.head, query: queryText, x, y };
    });
  }

  // 매 렌더마다 최신 함수를 ref 에 저장해서 stable extension 안에서 호출.
  updateSlashMenuRef.current = (view: EditorView) => updateSlashMenuFromView(view);

  // CodeMirror 입력/선택 변경 시 슬래시 메뉴 후보를 다시 평가한다.
  // updateListener 가 한 박자 늦게 fire 되는 환경(IME 조합 직후 등) 을 대비해
  // native input/keyup 에서도 한 번 더 평가하고, onChange 에서도 직접 부른다.
  const slashMenuExtension = useMemo(
    () => [
      EditorView.updateListener.of((u) => {
        if (!u.docChanged && !u.selectionSet && !u.focusChanged) return;
        const view = u.view;
        queueMicrotask(() => updateSlashMenuRef.current(view));
      }),
      EditorView.domEventHandlers({
        input: (_e, view) => {
          queueMicrotask(() => updateSlashMenuRef.current(view));
        },
        keyup: (_e, view) => {
          queueMicrotask(() => updateSlashMenuRef.current(view));
        },
      }),
    ],
    [],
  );

  // (위키링크 자동완성은 ./wikilinkExtension 의 CodeMirror autocomplete 확장에서
  // 직접 처리한다. 메뉴 / 키보드 / 좌표 / dispatch 모두 CodeMirror 가 소유.)

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

  // CodeMirror paste/drop 확장이 항상 최신 uploadAndInsert (= activeNoteId/token
  // 클로저) 를 호출하도록 매 렌더마다 모듈 전역 슬롯을 갱신한다.
  useEffect(() => {
    setEditorInsertFile((file) => void uploadAndInsert(file));
  });
  useEffect(() => {
    return () => setEditorInsertFile(null);
  }, []);

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

  function openCommandPalette() {
    setCommandQuery("");
    setCommandPaletteOpen(true);
  }

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && (ev.key.toLowerCase() === "k" || ev.key.toLowerCase() === "p")) {
        ev.preventDefault();
        openCommandPalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    window.setTimeout(() => commandInputRef.current?.focus(), 0);
  }, [commandPaletteOpen]);

  const appCommands: AppCommand[] = [
    {
      id: "new-note",
      title: "새 노트",
      description: "루트에 빈 노트를 만들고 제목 입력으로 이동",
      shortcut: "N",
      keywords: "new note 새노트",
      run: () => void handleNewNote(),
    },
    {
      id: "today-note",
      title: "오늘 노트 열기",
      description: `${todayNoteTitle()} 노트를 열거나 새로 만들기`,
      shortcut: "Daily",
      keywords: "daily today 오늘 데일리 날짜",
      run: () => void handleOpenTodayNote(),
    },
    {
      id: "insert-image",
      title: "이미지 삽입",
      description: "현재 본문 캐럿 위치에 이미지 업로드",
      shortcut: "/이미지",
      keywords: "image photo picture 이미지 사진",
      disabled: !activeNoteId,
      run: () => imageInputRef.current?.click(),
    },
    {
      id: "toggle-drawing",
      title: drawingMode ? "그리기 모드 끄기" : "그리기 모드 켜기",
      description: "본문 위 자유 필기 레이어 토글",
      shortcut: "/그림",
      keywords: "draw canvas pen 그림 필기",
      disabled: !activeNoteId,
      run: () => setDrawingMode((v) => !v),
    },
    {
      id: "todos-panel",
      title: "모든 할 일 보기",
      description: "우측 패널에서 전체 체크리스트 모아보기",
      shortcut: "Todos",
      keywords: "todo checklist 할일 체크리스트",
      disabled: !activeNoteId,
      run: () => setRightPanel(rightPanel === "todos" ? null : "todos"),
    },
    {
      id: "files-panel",
      title: "첨부 패널 열기",
      description: "현재 노트의 첨부 파일 보기",
      keywords: "file attachment 첨부 파일",
      disabled: !activeNoteId,
      run: () => setRightPanel(rightPanel === "files" ? null : "files"),
    },
    {
      id: "versions-panel",
      title: "버전 히스토리 열기",
      description: "현재 노트의 저장 버전 확인",
      keywords: "version history 버전 히스토리",
      disabled: !activeNoteId,
      run: () => setRightPanel(rightPanel === "versions" ? null : "versions"),
    },
    {
      id: "focus-search",
      title: "검색으로 이동",
      description: "사이드바 검색창에 포커스",
      shortcut: "Search",
      keywords: "search find 검색 찾기",
      run: () => {
        setSidebarCollapsed(false);
        searchInputRef.current?.focus();
      },
    },
    {
      id: "export-markdown",
      title: "Markdown 내보내기",
      description: "전체 노트 Markdown export 다운로드",
      keywords: "export markdown 내보내기 백업",
      run: () => void handleExport(),
    },
  ];

  const commandNeedle = commandQuery.trim().toLowerCase();
  const filteredAppCommands = appCommands.filter((cmd) => {
    if (!commandNeedle) return true;
    return `${cmd.title} ${cmd.description} ${cmd.keywords}`.toLowerCase().includes(commandNeedle);
  });

  const slashCommands = [
    {
      id: "todo",
      title: "체크리스트",
      description: "체크박스 할 일 항목 삽입",
      keywords: "todo checklist 체크 할일",
      run: () => replaceSlashCommand("- [ ] "),
    },
    {
      id: "h1",
      title: "제목 1",
      description: "큰 제목 삽입",
      keywords: "heading h1 제목",
      run: () => replaceSlashCommand("# "),
    },
    {
      id: "h2",
      title: "제목 2",
      description: "중간 제목 삽입",
      keywords: "heading h2 제목",
      run: () => replaceSlashCommand("## "),
    },
    {
      id: "quote",
      title: "인용",
      description: "인용 블록 삽입",
      keywords: "quote blockquote 인용",
      run: () => replaceSlashCommand("> "),
    },
    {
      id: "date-link",
      title: "오늘 날짜 링크",
      description: `[[${todayNoteTitle()}]] 삽입`,
      keywords: "date today daily 날짜 오늘",
      run: () => replaceSlashCommand(`[[${todayNoteTitle()}]]`),
    },
    {
      id: "image",
      title: "이미지",
      description: "이미지를 업로드해 현재 위치에 삽입",
      keywords: "image photo 이미지 사진",
      run: () => {
        replaceSlashCommand("");
        imageInputRef.current?.click();
      },
    },
    {
      id: "drawing",
      title: "그리기",
      description: "본문 위 자유 필기 모드 켜기",
      keywords: "draw canvas 그림 필기",
      run: () => {
        replaceSlashCommand("");
        setDrawingMode(true);
      },
    },
    {
      id: "audio",
      title: "음성 녹음",
      description: "녹음을 시작하고 완료 후 본문에 첨부",
      keywords: "audio mic voice 음성 녹음",
      run: () => {
        replaceSlashCommand("");
        void startAudioRecording();
      },
    },
  ];

  const slashNeedle = slashMenu?.query.trim().toLowerCase() ?? "";
  const filteredSlashCommands = slashCommands.filter((cmd) => {
    if (!slashNeedle) return true;
    return `${cmd.title} ${cmd.description} ${cmd.keywords}`.toLowerCase().includes(slashNeedle);
  });

  // 메뉴 열림 / 쿼리 변동 시 선택 인덱스 0 으로 리셋. 필터 결과가 줄어들면
  // 인덱스가 범위 밖으로 갈 수 있어서 그것도 클램프한다.
  useEffect(() => {
    if (!slashMenu) {
      setSlashSelected(0);
      return;
    }
    setSlashSelected((prev) => {
      const max = Math.max(0, filteredSlashCommands.length - 1);
      if (prev > max) return 0;
      return prev;
    });
  }, [slashMenu?.from, slashMenu?.query, filteredSlashCommands.length]);

  useEffect(() => {
    if (!slashMenu) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        setSlashMenu(null);
        return;
      }
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        setSlashSelected((i) => Math.min(filteredSlashCommands.length - 1, i + 1));
        return;
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        setSlashSelected((i) => Math.max(0, i - 1));
        return;
      }
      if (ev.key === "Enter" || ev.key === "Tab") {
        const cmd = filteredSlashCommands[slashSelected] ?? filteredSlashCommands[0];
        if (!cmd) return;
        ev.preventDefault();
        cmd.run();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [filteredSlashCommands, slashMenu, slashSelected]);

  // ---------- 위키링크 클릭 네비게이션 + 신규 노트 생성 ----------

  // 같은 제목의 노트가 이미 있으면 그걸 열고, 없으면 새로 만들고 본문에 링크만
  // 박는다. autocomplete 확장에서 "새 노트 만들기" 항목을 고를 때 이 함수를
  // 호출한다. 만든 노트로 곧장 이동하지는 않는다 (사용자가 편집하던 노트의
  // 흐름을 끊지 않기 위해). 그 노트로 가고 싶으면 새로 박힌 위키링크를 클릭하면
  // navigateToWikilink 가 그때 연다.
  const handleCreateNoteFromWikilink = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      try {
        await api.createNote(token, { title: trimmed, content: "" });
        await reloadNotes();
      } catch (e) {
        handleApiError(e);
      }
    },
    [handleApiError, reloadNotes, token],
  );

  // 위키링크 클릭 → 같은 제목 노트로 이동. 없으면 그 자리에서 만든다.
  const navigateToWikilink = useCallback(
    async (rawTitle: string) => {
      const title = rawTitle.trim();
      if (!title) return;
      const lower = title.toLowerCase();
      const liveNotes = notes.filter((n) => !n.deleted_at);
      const exact = liveNotes.find((n) => (n.title || "").toLowerCase() === lower);
      const target =
        exact ?? liveNotes.find((n) => (n.title || "").toLowerCase().startsWith(lower));
      try {
        if (target) {
          await loadNote(target.id);
          if (typeof window !== "undefined" && window.innerWidth < 768) setPanel("editor");
          return;
        }
        const draft = await api.createNote(token, { title, content: "" });
        await reloadNotes();
        await loadNote(draft.id);
        if (typeof window !== "undefined" && window.innerWidth < 768) setPanel("editor");
      } catch (e) {
        handleApiError(e);
      }
    },
    [handleApiError, loadNote, notes, reloadNotes, token],
  );

  // CodeMirror 위젯이 항상 최신 navigateToWikilink (= notes/token 클로저) 를 호출
  // 하도록 매 렌더마다 모듈 전역 슬롯을 갱신한다. setEditorInsertFile 과 같은 패턴.
  useEffect(() => {
    setEditorNavigateLink((title) => void navigateToWikilink(title));
  });
  useEffect(() => {
    return () => setEditorNavigateLink(null);
  }, []);

  // 위키링크 autocomplete 확장은 한 번만 구성한다. notes 가 바뀔 때마다 확장을
  // 새로 만들면 CodeMirror 가 reconfig 를 일으켜 무겁고, autocomplete 메뉴가
  // 열려 있는 동안 상태가 깨진다. 그래서 실제 데이터(notes / 노트 생성 콜백) 는
  // ref 로 들고, 확장은 ref 를 통해 항상 최신 클로저를 읽는다.
  const wikilinkNotesRef = useRef(notes);
  wikilinkNotesRef.current = notes;
  const wikilinkCreateRef = useRef(handleCreateNoteFromWikilink);
  wikilinkCreateRef.current = handleCreateNoteFromWikilink;
  const wikilinkExt = useMemo(
    () =>
      wikilinkAutocompleteExtension({
        getNotes: () =>
          wikilinkNotesRef.current
            .filter((n) => !n.deleted_at)
            .map((n) => ({ id: n.id, title: n.title || "" })),
        createNote: (title) => void wikilinkCreateRef.current(title),
      }),
    [],
  );

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

  // 폴더 트리 / 검색 / DnD / 멀티선택은 ./WorkbenchSidebar 로 분리. 상태와 핸들러
  // 는 여전히 Workbench 가 들고 있고, 이 컴포넌트는 props 로만 표시한다. (renderNoteRow,
  // renderTreeItems, sidebarCard JSX, 그리고 두 개의 작은 derived 값
  // rootNotesNode / draggingNeedsRootLanding 도 모두 그쪽으로 이사.)
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
      handleNewNoteIn={(id) => void handleNewNoteIn(id)}
      debouncedQuery={debouncedQuery}
      notes={notes}
      expandedFolders={expandedFolders}
      toggleFolderExpanded={toggleFolderExpanded}
      childrenOf={childrenOf}
      notesInFolder={notesInFolder}
      showTree={showTree}
      activeNoteId={activeNoteId}
      selectedNoteIds={selectedNoteIds}
      setSelectedFolderId={setSelectedFolderId}
      handleSelectNote={handleSelectNote}
      loadNote={(id) => void loadNote(id)}
      renaming={renaming}
      setRenaming={setRenaming}
      commitRename={() => void commitRename()}
      cancelRename={cancelRename}
      creatingFolder={creatingFolder}
      setCreatingFolder={setCreatingFolder}
      commitCreateFolder={() => void commitCreateFolder()}
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
      resolveDraggedPayload={resolveDraggedPayload}
      handleMoveNoteToFolder={(nid, fid) => void handleMoveNoteToFolder(nid, fid)}
      handleMoveNotesToFolder={(nids, fid) => void handleMoveNotesToFolder(nids, fid)}
      handleMoveFolderToParent={(fid, pid) => void handleMoveFolderToParent(fid, pid)}
      usage={usage}
      handleExport={() => void handleExport()}
    />
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
                ref={imageInputRef}
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

            {/* 우측 패널 토글: 첨부 / 할 일 / 버전 */}
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
              onClick={() => setRightPanel(rightPanel === "todos" ? null : "todos")}
              title="모든 할 일"
              aria-label="모든 할 일 토글"
              className={`grid h-7 w-7 place-items-center rounded ${
                rightPanel === "todos" ? "bg-black/10 text-ink-900" : "hover:bg-black/5 hover:text-ink-900"
              }`}
            >
              <IconList size={15} />
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

        {/* 그리기 툴바 — 메타 툴바 바로 아래의 별도 행. 본문 스크롤 영역
            바깥에 두므로 제목/스크롤과 겹치지 않고 항상 같은 자리에 보인다. */}
        <div className="flex items-center gap-1 border-b border-ink-900/10 bg-[#fafaf9] px-3 py-1.5">
          <button
            type="button"
            onClick={() => setDrawingMode((v) => !v)}
            title={drawingMode ? "그리기 끄기" : "본문 위에 자유 그리기"}
            aria-pressed={drawingMode}
            className={`grid h-7 w-7 place-items-center rounded ${
              drawingMode ? "bg-indigo-500 text-white" : "text-ink-900/65 hover:bg-black/5 hover:text-ink-900"
            }`}
          >
            <IconBrush size={15} />
          </button>
          {drawingMode && (
            <>
              <span className="mx-1 h-4 w-px bg-ink-900/15" />
              <button
                type="button"
                onClick={() => setDrawingTool("pen")}
                title="펜"
                aria-pressed={drawingTool === "pen"}
                className={`grid h-7 w-7 place-items-center rounded ${
                  drawingTool === "pen" ? "bg-black/10 text-ink-900" : "text-ink-900/65 hover:bg-black/5"
                }`}
              >
                <IconBrush size={15} />
              </button>
              <button
                type="button"
                onClick={() => setDrawingTool("highlighter")}
                title="형광펜"
                aria-pressed={drawingTool === "highlighter"}
                className={`grid h-7 w-7 place-items-center rounded ${
                  drawingTool === "highlighter" ? "bg-black/10 text-ink-900" : "text-ink-900/65 hover:bg-black/5"
                }`}
              >
                <IconHighlighter size={15} />
              </button>
              <button
                type="button"
                onClick={() => setDrawingTool("eraser")}
                title="지우개(stroke 단위)"
                aria-pressed={drawingTool === "eraser"}
                className={`grid h-7 w-7 place-items-center rounded ${
                  drawingTool === "eraser" ? "bg-black/10 text-ink-900" : "text-ink-900/65 hover:bg-black/5"
                }`}
              >
                <IconEraser size={15} />
              </button>
              <span className="mx-1 h-4 w-px bg-ink-900/15" />
              {/* 색 swatch */}
              {["#1f2937", "#dc2626", "#2563eb", "#16a34a", "#f59e0b"].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDrawingColor(c)}
                  title={c}
                  className={`h-5 w-5 rounded-full border ${
                    drawingColor === c ? "border-ink-900 ring-2 ring-indigo-300" : "border-ink-900/20"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <span className="mx-1 h-4 w-px bg-ink-900/15" />
              <input
                type="range"
                min={1}
                max={20}
                step={0.5}
                value={drawingWidth}
                onChange={(ev) => setDrawingWidth(Number(ev.target.value))}
                className="h-5 w-24"
                title={`굵기 ${drawingWidth}px`}
              />
              <span className="text-[11px] tabular-nums text-ink-900/55">{drawingWidth.toFixed(1)}</span>
              <span className="mx-1 h-4 w-px bg-ink-900/15" />
              <button
                type="button"
                onClick={() => overlayHandleRef.current?.undo()}
                title="되돌리기"
                className="grid h-7 w-7 place-items-center rounded text-ink-900/65 hover:bg-black/5 hover:text-ink-900"
              >
                <IconUndo size={15} />
              </button>
              <button
                type="button"
                onClick={() => overlayHandleRef.current?.redo()}
                title="다시 실행"
                className="grid h-7 w-7 place-items-center rounded text-ink-900/65 hover:bg-black/5 hover:text-ink-900"
              >
                <IconRedo size={15} />
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (overlayStrokes.length === 0) return;
                  const ok = await askConfirm({
                    title: "그림 전체 삭제",
                    message: "이 노트의 그림 레이어를 모두 지우시겠어요? 이 작업은 되돌리기로만 복구할 수 있어요.",
                    confirmLabel: "전부 지우기",
                  });
                  if (!ok) return;
                  overlayHandleRef.current?.clear();
                }}
                title="전부 지우기"
                className="ml-1 rounded px-1.5 text-[11px] text-ink-900/55 hover:bg-black/5 hover:text-ink-900"
              >
                전부 지우기
              </button>
            </>
          )}
        </div>

        {/* 본문 */}
        <main className="scrollbar-subtle relative flex-1 overflow-y-auto overflow-x-hidden px-6 py-6 md:px-10">
          {/* 본문 컨텐츠 + 그림 레이어를 같은 positioning context 에 둔다.
              그래야 absolute layer 가 본문과 함께 스크롤되고, 본문 폭에 정확히
              겹친다. */}
          <div className="relative">
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

          <section className="relative mx-auto w-full max-w-3xl min-h-[62dvh] py-2">
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
                editorMediaInputHandlers,
                editorCursorTracker,
                editorCursorBackupSync,
                editorChecklistAutoTrigger,
                editorUndoRedoKeymap,
                editorQuoteEnterKeymap,
                editorNavAndDeleteKeymap,
                slashMenuExtension,
                wikilinkExt,
              ]}
              placeholder="내용은 Markdown 스타일로 자유롭게 작성하세요. 자동 저장이 켜져 있습니다."
              onCreateEditor={(view) => {
                editorViewRef.current = view;
              }}
              onChange={(value) => {
                setContent(value);
                if (!composingRef.current) scheduleAutosave();
                // 슬래시 메뉴: onChange 시점에도 즉시 평가해서 갱신.
                // (위키링크 메뉴는 CodeMirror autocomplete 가 직접 들고 있다.)
                const view = editorViewRef.current;
                if (view) {
                  updateSlashMenuFromView(view);
                }
              }}
              className="[&_.cm-editor]:border-0 [&_.cm-editor]:bg-transparent [&_.cm-editor]:font-inherit [&_.cm-scroller]:text-[15px] [&_.cm-scroller]:leading-6 [&_.cm-content]:min-h-[58dvh] [&_.cm-content]:px-0 [&_.cm-content]:py-1"
            />
            {slashMenu && filteredSlashCommands.length > 0 ? (
              <div
                className="fixed z-[70] w-72 overflow-hidden rounded-xl border border-ink-900/12 bg-white text-[13px] shadow-xl"
                style={{ left: slashMenu.x, top: slashMenu.y }}
              >
                <div className="border-b border-ink-900/8 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-900/40">
                  슬래시 커맨드 · ↑↓ 이동 · Enter 실행 · Esc 닫기
                </div>
                <div className="max-h-72 overflow-y-auto py-1">
                  {filteredSlashCommands.slice(0, 8).map((cmd, idx) => {
                    const selected = idx === slashSelected;
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        className={`block w-full px-3 py-2 text-left ${
                          selected ? "bg-indigo-50" : "hover:bg-black/5"
                        }`}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onMouseEnter={() => setSlashSelected(idx)}
                        onClick={() => cmd.run()}
                      >
                        <span
                          className={`block font-semibold ${
                            selected ? "text-indigo-700" : "text-ink-900"
                          }`}
                        >
                          {cmd.title}
                        </span>
                        <span className="block text-[11px] text-ink-900/45">
                          {cmd.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {/* 위키링크 자동완성 메뉴는 CodeMirror autocomplete 가 직접 그린다.
                React JSX 오버레이로 두면 메뉴 ↔ 에디터 selection 사이의 timing
                desync 가 잡기 어려워서 메뉴 자체의 소유권을 CodeMirror 로 옮겼다. */}
          </section>
          {/* 본문 위에 떠 있는 자유 그림 레이어. drawingMode 가 false 면 입력
              이 통과돼서 텍스트 편집에 영향 없음. */}
          <OverlayDrawingLayer
            ref={overlayHandleRef}
            enabled={drawingMode}
            tool={drawingTool}
            color={drawingColor}
            width={drawingWidth}
            strokes={overlayStrokes}
            onStrokesChange={setOverlayStrokes}
          />
          </div>
        </main>
      </section>
    );
  }

  // ---------- 우측 토글 패널: 첨부 / 할 일 / 버전 ----------
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
            onClick={() => setRightPanel("todos")}
            className={`rounded px-2 py-0.5 ${rightPanel === "todos" ? "bg-black/10 text-ink-900" : "text-ink-900/55 hover:bg-black/5"}`}
          >
            할 일
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
          ) : rightPanel === "todos" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[12px] font-semibold text-ink-900">모든 할 일</p>
                  <p className="text-[11px] text-ink-900/45">
                    미완료 {todoItems.filter((x) => !x.checked).length}개 · 완료{" "}
                    {todoItems.filter((x) => x.checked).length}개
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshTodoItems()}
                  className="rounded border border-ink-900/10 bg-white px-2 py-1 text-[11px] text-ink-900/60 hover:bg-black/5"
                >
                  새로고침
                </button>
              </div>
              {todoLoading ? (
                <p className="rounded border border-ink-900/10 bg-white px-3 py-4 text-center text-[12px] text-ink-900/45">
                  할 일을 불러오는 중…
                </p>
              ) : todoItems.length === 0 ? (
                <p className="rounded border border-ink-900/10 bg-white px-3 py-4 text-center text-[12px] text-ink-900/45">
                  아직 체크리스트가 없습니다. 본문에 <span className="font-mono">- [ ] 할 일</span> 로 작성해보세요.
                </p>
              ) : (
                <div className="space-y-2">
                  {todoItems
                    .slice()
                    .sort((a, b) => Number(a.checked) - Number(b.checked) || a.noteTitle.localeCompare(b.noteTitle))
                    .map((item) => (
                      <article
                        key={item.id}
                        className={`rounded border border-ink-900/10 bg-white p-2 ${
                          item.checked ? "opacity-60" : ""
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            aria-label={item.checked ? "할 일 미완료로 바꾸기" : "할 일 완료로 바꾸기"}
                            aria-pressed={item.checked}
                            onClick={() => void toggleTodoFromPanel(item)}
                            className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[11px] leading-none ${
                              item.checked
                                ? "border-emerald-500 bg-emerald-500 text-white"
                                : "border-ink-900/25 bg-white text-transparent hover:border-emerald-500"
                            }`}
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            onClick={() => void loadNote(item.noteId)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p
                              className={`break-words text-[13px] ${
                                item.checked ? "line-through text-ink-900/45" : "text-ink-900"
                              }`}
                            >
                              {item.text}
                            </p>
                            <p className="mt-1 truncate text-[11px] text-ink-900/40">
                              {item.noteTitle} · {item.lineIndex + 1}번째 줄
                            </p>
                          </button>
                        </div>
                      </article>
                    ))}
                </div>
              )}
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

      <CommandPalette
        open={commandPaletteOpen}
        query={commandQuery}
        onQueryChange={setCommandQuery}
        filteredCommands={filteredAppCommands}
        inputRef={commandInputRef}
        onClose={() => setCommandPaletteOpen(false)}
        onRun={(cmd) => {
          setCommandPaletteOpen(false);
          setCommandQuery("");
          cmd.run();
        }}
      />

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

