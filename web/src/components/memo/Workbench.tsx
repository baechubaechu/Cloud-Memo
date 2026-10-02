"use client";

import { useRouter } from "next/navigation";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";
import { IconArchive, IconList, IconLogOut, IconPlus, IconSidebarToggle, IconStar } from "./Icons";
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
  memoEditorContextExtension,
  resetLastDocCursor,
} from "./editor";
import {
  REASON_LABEL,
  DND_MIME_NOTE,
  DND_MIME_NOTE_MULTI,
  DND_MIME_FOLDER,
  compareName,
} from "./utils";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { flushSync } from "react-dom";

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
import { type OverlayDrawingLayerHandle, type OverlayDrawingTool } from "./OverlayDrawingLayer";
import { parseChecklistLine } from "./markdown";
import type {
  ConfirmDialogState,
  ContextMenuTarget,
  DragItem,
  HoverMeta,
  ListMode,
  SelectionAnchor,
  TodoPanelItem,
  SlashMenuState,
} from "./workbenchTypes";
import { overlaySignature, todayNoteTitle, extractTodoItems, DEFAULT_NEW_NOTE_TITLE } from "./workbenchHelpers";
import { CommandPalette } from "./CommandPalette";
import { ConfirmDialog, ContextMenu, HoverTooltip } from "./WorkbenchOverlays";
import { WorkbenchSidebar } from "./WorkbenchSidebar";
import { WorkbenchRightPanel } from "./WorkbenchRightPanel";
import { WorkbenchEditorCard } from "./WorkbenchEditor";
import { buildAppCommands, buildSlashCommands } from "./workbenchCommands";
import { wikilinkAutocompleteExtension } from "./wikilinkExtension";

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
  const notesRef = useRef(notes);

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
  /** setState 직후 디바운스된 flushAutosave 가 옛 title/content 클로저를 읽는 것을 막기 위한 동기 초안 */
  const draftTitleRef = useRef("");
  const draftContentRef = useRef("");
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
  // Facet 컨텍스트의 insert/navigate 는 확장이 안정적이어야 하므로, 최신 구현은 ref 로 전달.
  const memoEditorInsertFileRef = useRef<(file: File) => void>(() => {});
  const memoEditorNavigateLinkRef = useRef<(title: string) => void>(() => {});
  // 위키링크 자동완성은 ./wikilinkExtension 의 CodeMirror autocomplete 확장이
  // 직접 들고 있다. 메뉴 상태 / 키보드 선택 / DOM 좌표 추적 모두 CodeMirror 가
  // 관리하므로 React state 는 두지 않는다.
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
  /** loadNote 가 오래된 closure 를 쓰지 않도록 — 노트 전환 직전 flush 에 최신 id/detail 필요 */
  const activeNoteIdRef = useRef<string | undefined>(undefined);
  const activeNoteRef = useRef<NoteDetail | undefined>(undefined);

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
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    activeNoteIdRef.current = activeNoteId;
  }, [activeNoteId]);
  useEffect(() => {
    activeNoteRef.current = activeNote;
  }, [activeNote]);

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

  /** 제목 input·CodeMirror 에만 있고 아직 ref/state 에 안 올라온 글자까지 플러시에 포함 */
  function syncDraftFromDom(): void {
    const titleEl = titleInputRef.current;
    if (titleEl) draftTitleRef.current = titleEl.value;
    const view = editorViewRef.current;
    if (view) draftContentRef.current = view.state.doc.toString();
  }

  const flushDraftForNote = useCallback(
    async (noteId: string, note: NoteDetail, forceSnapshot?: boolean): Promise<boolean> => {
      if (!noteId || note.deleted_at) return true;
      syncDraftFromDom();
      const nextTitle = draftTitleRef.current;
      const nextContent = draftContentRef.current;
      const sameTitle = nextTitle === lastSentRef.current.title;
      const sameBody = nextContent === lastSentRef.current.content;
      if (sameTitle && sameBody && !forceSnapshot) return true;

      try {
        setSaveState("saving");
        const updated = await api.patchNote(token, noteId, {
          title: nextTitle,
          content: nextContent,
          tag_ids: note.tags.map((x) => x.id),
          folder_id: note.folder_id ?? null,
          force_snapshot: !!forceSnapshot,
        });
        setActiveNote(updated);
        draftTitleRef.current = updated.title;
        draftContentRef.current = updated.content;
        setTitle(updated.title);
        setContent(updated.content);
        lastSentRef.current = {
          title: updated.title,
          content: updated.content,
          overlayKey: overlaySignature(updated.overlay_strokes ?? []),
        };
        setSaveState("saved");
        void reloadNotes();
        void refreshUsage();
        const vers = await api.listVersions(token, noteId);
        setVersions(vers);
        return true;
      } catch (e) {
        handleApiError(e);
        setSaveState("dirty");
        return false;
      }
    },
    [handleApiError, refreshUsage, reloadNotes, token],
  );

  const flushAutosave = useCallback(
    async (forceSnapshot?: boolean) => {
      if (!activeNoteId || !activeNote || activeNote.deleted_at) return;
      await flushDraftForNote(activeNoteId, activeNote, forceSnapshot);
    },
    [activeNote, activeNoteId, flushDraftForNote],
  );

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
          const saved = await flushDraftForNote(prevId, prevNote, false);
          if (!saved) return;
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
        draftTitleRef.current = optimisticTitle;
        setTitle(optimisticTitle);

        const note = await api.getNote(token, id);
        setActiveNote(note);
        draftTitleRef.current = note.title;
        draftContentRef.current = note.content;
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
    [flushDraftForNote, handleApiError, token],
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
        const updated = await api.patchNote(token, item.noteId, {
          content: nextContent,
          title: isActive ? draftTitleRef.current : note.title,
          tag_ids: note.tags.map((x) => x.id),
          folder_id: note.folder_id ?? null,
        });
        if (isActive) {
          setContent(nextContent);
          draftContentRef.current = nextContent;
          setActiveNote(updated);
          lastSentRef.current = {
            ...lastSentRef.current,
            title: draftTitleRef.current,
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
    [activeNote, activeNoteId, content, handleApiError, refreshTodoItems, reloadNotes, token],
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
      const v = ev.currentTarget.value;
      draftTitleRef.current = v;
      setTitle(v);
      scheduleAutosave();
    },
    [scheduleAutosave],
  );

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
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      armTitleFocusGuardRef.current?.dispose();
    };
  }, []);

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
      const draft = await api.createNote(token, {
        title: DEFAULT_NEW_NOTE_TITLE,
        content: "",
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
          draftTitleRef.current = draft;
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

  async function handleNewNote() {
    try {
      setError(null);
      const draft = await api.createNote(token, {
        title: DEFAULT_NEW_NOTE_TITLE,
        content: "",
        folder_id: null,
        tag_ids: selectedTagId ? [selectedTagId] : [],
      });
      await activateFreshDraft(draft);
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
      const saved = await flushDraftForNote(prevId, prevNote, false);
      if (!saved) return;
    }

    pendingFocusNewNoteRef.current = draft.id;

    flushSync(() => {
      resetLastDocCursor();
      setActiveNoteId(draft.id);
      setActiveNote(draft);
      draftTitleRef.current = draft.title;
      draftContentRef.current = draft.content;
      setTitle(draft.title);
      setContent(draft.content);
      const incomingOverlay = Array.isArray(draft.overlay_strokes) ? draft.overlay_strokes : [];
      setOverlayStrokes(incomingOverlay);
      setDrawingMode(false);
      lastSentRef.current = {
        title: draft.title,
        content: draft.content,
        overlayKey: overlaySignature(incomingOverlay),
      };
      setSaveState("saved");
    });

    void reloadNotes();
    api
      .listVersions(token, draft.id)
      .then(setVersions)
      .catch(() => {});
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
        draftTitleRef.current = "";
        draftContentRef.current = "";
        setTitle("");
        setContent("");
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
        draftTitleRef.current = "";
        draftContentRef.current = "";
        setTitle("");
        setContent("");
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
  });

  const commandNeedle = commandQuery.trim().toLowerCase();
  const filteredAppCommands = appCommands.filter((cmd) => {
    if (!commandNeedle) return true;
    return `${cmd.title} ${cmd.description} ${cmd.keywords}`.toLowerCase().includes(commandNeedle);
  });

  const slashCommands = buildSlashCommands({
    imageInputRef,
    setDrawingMode,
    startAudioRecording,
    replaceSlashCommand,
  });

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
          return;
        }
        const draft = await api.createNote(token, { title, content: "" });
        await reloadNotes();
        await loadNote(draft.id);
      } catch (e) {
        handleApiError(e);
      }
    },
    [handleApiError, loadNote, notes, reloadNotes, token],
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

  // 편집 중인 제목은 IME 조합 때문에 서버 반영·reloadNotes 가 늦을 수 있다.
  // 사이드바/모바일 목록은 에디터의 title state 와 동기된 표시를 위해 활성 노트만 병합한다.
  const notesWithLiveTitle = useMemo(() => {
    if (!activeNoteId) return notes;
    return notes.map((n) => (n.id === activeNoteId ? { ...n, title } : n));
  }, [notes, activeNoteId, title]);

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
    notesWithLiveTitle
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
    [notesWithLiveTitle],
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

  const editorCard = (
    <WorkbenchEditorCard
      activeNote={activeNote}
      onNewNote={handleNewNote}
      onRestoreDeletedNote={() => void restoreActiveNote()}
      saveState={saveState}
      folderOptions={folderOptions}
      onMoveNoteFolder={handleMoveNoteFolder}
      onToggleFavorite={() => void toggleFavorite()}
      onToggleArchive={() => void toggleArchive()}
      onManualSnapshot={() => void handleManualSnapshot()}
      onTrashNote={() => {
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
        });
      }}
      imageInputRef={imageInputRef}
      onPickImageFile={(file) => void uploadAndInsert(file)}
      isRecording={isRecording}
      onToggleAudioRecording={() => {
        if (isRecording) stopAudioRecording();
        else void startAudioRecording();
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
        if (!composingRef.current) scheduleAutosave();
      }}
      onTitleCompositionStart={handleCompositionStart}
      onTitleCompositionEnd={handleTitleCompositionEnd}
      onTitleBlur={() => void flushAutosave(false)}
      allTags={tags}
      onToggleTagForActive={toggleTagForActive}
      content={content}
      onBodyChange={(value) => {
        draftContentRef.current = value;
        setContent(value);
        if (!composingRef.current) scheduleAutosave();
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
        handleTrashAttachment={handleTrashAttachment}
        todoItems={todoItems}
        todoLoading={todoLoading}
        refreshTodoItems={refreshTodoItems}
        toggleTodoFromPanel={toggleTodoFromPanel}
        loadNote={loadNote}
        versions={versions}
        handleRestoreVersion={handleRestoreVersion}
      />
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

