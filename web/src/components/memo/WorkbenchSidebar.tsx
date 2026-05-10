// 데스크톱 옵시디언풍 사이드바. Workbench 가 들고 있던 트리/검색/DnD/멀티선택
// JSX + 두 개의 큰 render helper(`renderNoteRow`, `renderTreeItems`) 를 통째로
// 옮긴 것. state / handler / selector 는 Workbench 가 그대로 들고 있고, 이
// 컴포넌트는 props 로만 받는다 (= 단방향 표시 컴포넌트).
//
// "props 가 30개가 넘는데 너무 많지 않냐" — 맞다. 다만 1차 분리 단계의 목표는
// "줄 수가 가장 큰 덩어리를 외부 파일로 빼되, 동작/상태 소유권은 건드리지 않는
// 다" 이다. 다음 단계에서 SidebarContext 같은 가벼운 컨텍스트로 prop 묶음을
// 정리할 수 있다.

import { type ReactElement, type RefObject } from "react";
import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFilePlus,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconSearch,
  IconStar,
} from "./Icons";
import { compareName, formatBytes } from "./utils";
import { DND_MIME_FOLDER, DND_MIME_NOTE, DND_MIME_NOTE_MULTI, dndHasMime } from "./utils";
import type { Folder, NoteListItem, StorageUsage, Tag } from "@/lib/api";
import type {
  ContextMenuTarget,
  CreatingFolderState,
  DragItem,
  HoverMeta,
  ListMode,
  RenamingState,
} from "./workbenchTypes";

export type WorkbenchSidebarProps = {
  // ---- 검색 ----
  query: string;
  onQueryChange: (next: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  activeSearchTagToken: string | null;
  tagAutocomplete: Tag[];
  applyTagAutocomplete: (tagName: string) => void;

  // ---- 헤더 (모드 표시 + 전체 펼침/접기 + 새 폴더 + 새 노트) ----
  mode: ListMode;
  folderOptions: Folder[];
  allFoldersExpanded: boolean;
  toggleExpandAllFolders: () => void;
  beginCreateFolder: (parentId: string | null) => void;
  handleNewNoteIn: (folderId: string | null) => void;
  debouncedQuery: string;

  // ---- 트리 데이터 ----
  notes: NoteListItem[];
  expandedFolders: Set<string>;
  toggleFolderExpanded: (folderId: string) => void;
  childrenOf: (parentId: string | null) => Folder[];
  notesInFolder: (folderId: string | null) => NoteListItem[];
  showTree: boolean;

  // ---- 활성 / 선택 ----
  activeNoteId: string | undefined;
  selectedNoteIds: Set<string>;
  setSelectedFolderId: (id: string | undefined) => void;
  handleSelectNote: (
    note: NoteListItem,
    opts: { shiftKey: boolean; toggleKey: boolean },
  ) => void;
  loadNote: (id: string) => void;

  // ---- 인라인 이름 변경 ----
  renaming: RenamingState;
  setRenaming: (
    updater:
      | RenamingState
      | ((prev: RenamingState) => RenamingState),
  ) => void;
  commitRename: () => void;
  cancelRename: () => void;

  // ---- 인라인 새 폴더 생성 ----
  creatingFolder: CreatingFolderState;
  setCreatingFolder: (
    updater:
      | CreatingFolderState
      | ((prev: CreatingFolderState) => CreatingFolderState),
  ) => void;
  commitCreateFolder: () => void;
  cancelCreateFolder: () => void;

  // ---- 컨텍스트 메뉴 / 호버 (트리거만) ----
  setContextMenu: (target: ContextMenuTarget | null) => void;
  scheduleHoverMeta: (
    meta: Omit<HoverMeta, "x" | "y">,
    x: number,
    y: number,
  ) => void;
  setHoverMeta: (
    updater: HoverMeta | null | ((prev: HoverMeta | null) => HoverMeta | null),
  ) => void;
  clearHoverMeta: () => void;

  // ---- 드래그 앤 드롭 ----
  draggedItem: DragItem | null;
  setDraggedItem: (item: DragItem | null) => void;
  draggedItemRef: { current: DragItem | null };
  folderDropHoverId: string | null;
  setFolderDropHoverId: (id: string | null) => void;
  rootDropActive: boolean;
  setRootDropActive: (v: boolean) => void;
  canDropIntoFolder: (folderId: string, item: DragItem | null) => boolean;
  resolveDraggedPayload: (
    ev: React.DragEvent,
  ) => { noteId?: string; noteIds?: string[]; folderId?: string };
  handleMoveNoteToFolder: (noteId: string, folderId: string | null) => void;
  handleMoveNotesToFolder: (noteIds: string[], folderId: string | null) => void;
  handleMoveFolderToParent: (folderId: string, parentId: string | null) => void;

  // ---- 푸터 ----
  usage: StorageUsage | null;
  handleExport: () => void;
};

export function WorkbenchSidebar(props: WorkbenchSidebarProps): ReactElement {
  const {
    query,
    onQueryChange,
    searchInputRef,
    activeSearchTagToken,
    tagAutocomplete,
    applyTagAutocomplete,
    mode,
    folderOptions,
    allFoldersExpanded,
    toggleExpandAllFolders,
    beginCreateFolder,
    handleNewNoteIn,
    debouncedQuery,
    notes,
    expandedFolders,
    toggleFolderExpanded,
    childrenOf,
    notesInFolder,
    showTree,
    activeNoteId,
    selectedNoteIds,
    setSelectedFolderId,
    handleSelectNote,
    loadNote,
    renaming,
    setRenaming,
    commitRename,
    cancelRename,
    creatingFolder,
    setCreatingFolder,
    commitCreateFolder,
    cancelCreateFolder,
    setContextMenu,
    scheduleHoverMeta,
    setHoverMeta,
    clearHoverMeta,
    draggedItem,
    setDraggedItem,
    draggedItemRef,
    folderDropHoverId,
    setFolderDropHoverId,
    rootDropActive,
    setRootDropActive,
    canDropIntoFolder,
    resolveDraggedPayload,
    handleMoveNoteToFolder,
    handleMoveNotesToFolder,
    handleMoveFolderToParent,
    usage,
    handleExport,
  } = props;

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
            const dragNoteIds =
              selectedInSameFolder.length >= 2 ? selectedInSameFolder : [n.id];
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
            handleSelectNote(n, {
              shiftKey: ev.shiftKey,
              toggleKey: ev.metaKey || ev.ctrlKey,
            });
            loadNote(n.id);
          }}
          onKeyDown={(ev) => {
            if (isRenaming) return;
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              handleSelectNote(n, { shiftKey: false, toggleKey: false });
              loadNote(n.id);
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
              onBlur={() => commitRename()}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.preventDefault();
                  commitRename();
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
          className={`list-none rounded-md ${
            isDropTarget
              ? "border border-sky-400 bg-sky-100/60"
              : "border border-transparent"
          }`}
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
              handleMoveNotesToFolder(payload.noteIds, f.id);
              return;
            }
            if (payload.noteId) {
              handleMoveNoteToFolder(payload.noteId, f.id);
              return;
            }
            if (payload.folderId && payload.folderId !== f.id) {
              handleMoveFolderToParent(payload.folderId, f.id);
              return;
            }
            if (ghost?.kind === "note") {
              handleMoveNoteToFolder(ghost.id, f.id);
              return;
            }
            if (ghost?.kind === "note-multi") {
              handleMoveNotesToFolder(ghost.ids, f.id);
              return;
            }
            if (ghost?.kind === "folder" && ghost.id !== f.id) {
              handleMoveFolderToParent(ghost.id, f.id);
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
            className={`group flex items-center gap-1 rounded py-1 pr-1 hover:bg-black/5 ${
              isDragging ? "opacity-40" : ""
            }`}
            style={{ paddingLeft: 4 + depth * 14 }}
          >
            <span
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-900/45"
              aria-hidden="true"
            >
              {expanded ? (
                <IconChevronDown size={14} strokeWidth={2.6} />
              ) : (
                <IconChevronRight size={14} strokeWidth={2.6} />
              )}
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
                    setRenaming((prev) =>
                      prev ? { ...prev, draft: ev.target.value } : prev,
                    )
                  }
                  onFocus={(ev) => ev.currentTarget.select()}
                  onClick={(ev) => ev.stopPropagation()}
                  onMouseDown={(ev) => ev.stopPropagation()}
                  onDragStart={(ev) => ev.stopPropagation()}
                  onBlur={() => commitRename()}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") {
                      ev.preventDefault();
                      commitRename();
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
                  handleNewNoteIn(f.id);
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
              <ul
                className="border-l border-ink-900/15"
                style={{ marginLeft: 14 + depth * 14 }}
              >
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
                        onBlur={() => commitCreateFolder()}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") {
                            ev.preventDefault();
                            commitCreateFolder();
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
  // 자식이 비어있는 루트 영역에서만 "루트로 이동" landing 을 띄운다 (노트가 이미
  // 루트에 있으면 굳이 안내 띄울 필요 없음).
  const draggingNeedsRootLanding =
    !!draggedItem &&
    ((draggedItem.kind === "note" &&
      (notes.find((n) => n.id === draggedItem.id)?.folder_id ?? null) != null) ||
      (draggedItem.kind === "note-multi" &&
        draggedItem.ids.some(
          (id) => (notes.find((n) => n.id === id)?.folder_id ?? null) != null,
        )) ||
      (draggedItem.kind === "folder" &&
        (folderOptions.find((f) => f.id === draggedItem.id)?.parent_id ?? null) !=
          null));

  return (
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
            onChange={(ev) => onQueryChange(ev.target.value)}
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
            onClick={() => handleNewNoteIn(null)}
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
              if (Array.isArray(parsed))
                multi = parsed.filter((x): x is string => typeof x === "string");
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
            handleMoveNotesToFolder(multi, null);
          } else if (nid) {
            handleMoveNoteToFolder(nid, null);
          } else if (fid) {
            handleMoveFolderToParent(fid, null);
          } else if (ghost?.kind === "note") {
            handleMoveNoteToFolder(ghost.id, null);
          } else if (ghost?.kind === "note-multi") {
            handleMoveNotesToFolder(ghost.ids, null);
          } else if (ghost?.kind === "folder") {
            handleMoveFolderToParent(ghost.id, null);
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
                        if (Array.isArray(parsed))
                          multi = parsed.filter((x): x is string => typeof x === "string");
                      } catch {}
                    }
                    if (!fid && !nid && plain) {
                      if (notes.some((x) => x.id === plain)) nid = plain;
                      else if (folderOptions.some((x) => x.id === plain)) fid = plain;
                    }
                    draggedItemRef.current = null;
                    setDraggedItem(null);
                    setFolderDropHoverId(null);
                    if (multi.length >= 2) handleMoveNotesToFolder(multi, null);
                    else if (nid) handleMoveNoteToFolder(nid, null);
                    else if (fid) handleMoveFolderToParent(fid, null);
                    else if (ghost?.kind === "note")
                      handleMoveNoteToFolder(ghost.id, null);
                    else if (ghost?.kind === "note-multi")
                      handleMoveNotesToFolder(ghost.ids, null);
                    else if (ghost?.kind === "folder")
                      handleMoveFolderToParent(ghost.id, null);
                  }}
                  className={`rounded border border-dashed px-2 py-1.5 text-center text-[11px] text-ink-900/60 ${
                    rootDropActive
                      ? "border-sky-500 bg-sky-100/90"
                      : "border-ink-900/20 bg-white/50"
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
                    onBlur={() => commitCreateFolder()}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") {
                        ev.preventDefault();
                        commitCreateFolder();
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
}
