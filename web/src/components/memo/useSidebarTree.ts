// 사이드바 폴더 트리: 펼침 상태, 폴더·노트 이름 변경/이동/삭제, 새 폴더 입력 줄,
// 우클릭 메뉴, 끌어다 놓기(DnD), 노트 다중 선택과 Delete 키 삭제. Workbench 에서 분리.
// 표시는 ./WorkbenchSidebar 가 하고, 이 훅은 상태와 핸들러만 들고 있다.

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Folder, NoteListItem } from "@/lib/api";
import { api } from "@/lib/api";
import type { ContextMenuTarget, DragItem, SelectionAnchor } from "./workbenchTypes";
import { DND_MIME_FOLDER, DND_MIME_NOTE, DND_MIME_NOTE_MULTI, compareName } from "./utils";
import { useStableHandlers } from "./useStableHandlers";
import type { EditorSession } from "./useEditorSession";

const NO_FOLDERS: Folder[] = [];
const NO_NOTES: NoteListItem[] = [];

/** 순서를 유지한 채 key 별로 묶는다. */
function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

type Options = {
  token: string;
  folders: Folder[];
  notes: NoteListItem[];
  /** 활성 노트 제목을 편집 중인 값으로 바꾼 목록 (정렬·범위 선택용). */
  notesWithLiveTitle: NoteListItem[];
  /** 링크 갱신 알림을 띄우는 api.patchNote / api.patchFolder 래퍼. */
  patchNote: typeof api.patchNote;
  patchFolder: typeof api.patchFolder;
  refreshMeta: () => Promise<void>;
  reloadNotes: () => Promise<void>;
  refreshUsage: () => Promise<void>;
  askConfirm: (opts: { title: string; message: string; confirmLabel?: string }) => Promise<boolean>;
  handleApiError: (e: unknown) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setTitleWarning: Dispatch<SetStateAction<string | null>>;
  /** 열린 노트의 이름을 사이드바에서 바꾸면 제목 칸도 맞춘다. */
  session: EditorSession;
  /** 열린 노트를 닫는다 (지운 노트가 열려 있을 때). */
  closeActiveNote: () => void;
  selectedFolderId: string | undefined;
  setSelectedFolderId: Dispatch<SetStateAction<string | undefined>>;
  /** 다른 대화상자가 떠 있으면 Delete 키 삭제를 멈춘다. */
  suspended: boolean;
};

export function useSidebarTree(options: Options) {
  const {
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
    suspended,
  } = options;
  const { activeNoteId, draftTitleRef, setTitle } = session;

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
  // 노트 다중 선택(사이드바): 같은 folder_id 위계에서 Shift 범위 선택 지원
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const selectionAnchorRef = useRef<SelectionAnchor>(null);

  useEffect(() => {
    setSelectedNoteIds((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(notes.map((n) => n.id));
      const next = new Set(Array.from(prev).filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [notes]);

  useEffect(() => {
    if (selectedNoteIds.size === 0 || suspended) return;
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
  }, [handleDeleteSelectedNotes, selectedNoteIds.size, suspended]);

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
        await patchFolder(token, r.id, { name: draft });
        await refreshMeta();
      } else {
        const n = notes.find((x) => x.id === r.id);
        if (!n || draft === (n.title || "")) return;
        const updated = await patchNote(token, r.id, { title: draft, resolve_title_conflict: true });
        setError(null);
        await reloadNotes();
        if (draft && updated.title !== draft) {
          setTitleWarning(`같은 폴더에 '${draft}' 이름의 노트가 이미 있어 '${updated.title}'로 변경했습니다.`);
        }
        if (activeNoteId === r.id) {
          draftTitleRef.current = updated.title;
          setTitle(updated.title);
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
      await api.deleteNote(token, noteId);
      await reloadNotes();
      void refreshUsage();
      if (activeNoteId === noteId) closeActiveNote();
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleMoveNoteToFolder(noteId: string, folderId: string | null) {
    try {
      const note = notes.find((n) => n.id === noteId);
      if (note && (note.folder_id ?? null) === folderId) return;
      await patchNote(token, noteId, { folder_id: folderId });
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
      const results = await Promise.allSettled(targets.map((id) => patchNote(token, id, { folder_id: folderId })));
      await reloadNotes();
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") handleApiError(failed.reason);
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
      await patchFolder(token, folderId, { parent_id: parentId });
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

  async function handleDeleteSelectedNotes() {
    const targetNotes = notes.filter((n) => selectedNoteIds.has(n.id));
    if (targetNotes.length === 0) return;
    const msg =
      targetNotes.length === 1
        ? `'${targetNotes[0].title || "(무제 노트)"}' 노트를 삭제하시겠어요? 이 작업은 되돌릴 수 없습니다.`
        : `선택한 노트 ${targetNotes.length}개를 삭제하시겠어요? 이 작업은 되돌릴 수 없습니다.`;
    if (!(await askConfirm({ title: "노트 삭제", message: msg }))) return;
    try {
      await Promise.all(targetNotes.map((n) => api.deleteNote(token, n.id)));
      await reloadNotes();
      void refreshUsage();
      const removed = new Set(targetNotes.map((n) => n.id));
      if (activeNoteId && removed.has(activeNoteId)) closeActiveNote();
      setSelectedNoteIds(new Set());
      selectionAnchorRef.current = null;
    } catch (e) {
      handleApiError(e);
    }
  }

  // 폴더는 folderOptions에서 compareName(숫자→영문→한글)으로만 정렬됨. 그 순서 그대로
  // 부모별로 묶어 둔다 (트리를 그릴 때마다 전체를 다시 거르지 않게).
  const foldersByParent = useMemo(() => groupBy(folderOptions, (f) => f.parent_id ?? null), [folderOptions]);
  const childrenOf = useCallback(
    (parentId: string | null) => foldersByParent.get(parentId) ?? NO_FOLDERS,
    [foldersByParent],
  );
  // 노트는 별도 sort_order가 없으므로 이름 자연 정렬 (숫자→영문→한글). 목록이 바뀔 때만
  // 폴더별로 한 번 정렬한다.
  const notesByFolder = useMemo(() => {
    const groups = groupBy(notesWithLiveTitle, (n) => n.folder_id ?? null);
    for (const list of groups.values()) {
      list.sort((a, b) => compareName(a.title || "", b.title || "") || a.id.localeCompare(b.id));
    }
    return groups;
  }, [notesWithLiveTitle]);
  const notesInFolder = useCallback(
    (folderId: string | null) => notesByFolder.get(folderId) ?? NO_NOTES,
    [notesByFolder],
  );

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

  /**
   * 끌어 온 노트·노트 묶음·폴더를 targetFolderId 안으로 (null 이면 루트로) 옮긴다.
   * dataTransfer 를 먼저 보고, 못 읽으면(일부 브라우저) dragstart 때 적어 둔 ref 를 쓴다.
   */
  function dropOnto(ev: React.DragEvent, targetFolderId: string | null) {
    const ghost = draggedItemRef.current;
    const payload = resolveDraggedPayload(ev);
    draggedItemRef.current = null;
    setDraggedItem(null);
    setFolderDropHoverId(null);
    setRootDropActive(false);
    if (payload.noteIds && payload.noteIds.length >= 2) {
      void handleMoveNotesToFolder(payload.noteIds, targetFolderId);
      return;
    }
    if (payload.noteId) {
      void handleMoveNoteToFolder(payload.noteId, targetFolderId);
      return;
    }
    if (payload.folderId && payload.folderId !== targetFolderId) {
      void handleMoveFolderToParent(payload.folderId, targetFolderId);
      return;
    }
    if (ghost?.kind === "note") {
      void handleMoveNoteToFolder(ghost.id, targetFolderId);
      return;
    }
    if (ghost?.kind === "note-multi") {
      void handleMoveNotesToFolder(ghost.ids, targetFolderId);
      return;
    }
    if (ghost?.kind === "folder" && ghost.id !== targetFolderId) {
      void handleMoveFolderToParent(ghost.id, targetFolderId);
    }
  }

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

  // 사이드바(React.memo)에 넘기는 이벤트 핸들러는 렌더마다 새로 만들지 않는다.
  const handlers = useStableHandlers({
    beginCreateFolder,
    cancelCreateFolder,
    commitCreateFolder,
    toggleFolderExpanded,
    beginRename,
    cancelRename,
    commitRename,
    handleNoteContextDelete,
    handleMoveNoteToFolder,
    handleMoveNotesToFolder,
    handleMoveFolderToParent,
    handleDeleteFolder,
    dropOnto,
  });

  return {
    ...handlers,
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
    childrenOf,
    notesInFolder,
    handleSelectNote,
    canDropIntoFolder,
  };
}
