// 모바일 3패널(정리/목록/편집) 중 "정리" 와 "목록" 카드. 데스크톱 환경에서는
// 사이드바 (`WorkbenchSidebar.tsx`) 가 같은 역할을 하고 이 두 카드는 거의 보이지
// 않지만, 모바일 화면 폭 (md 미만) 에서는 사용자가 "사이드바" 토글로 직접 본다.
//
// 상태 / 핸들러 소유는 모두 MemoWorkbench 가 가진다. 이 파일은 props-only 표시
// 컴포넌트 두 개만 노출.

import { type ReactElement } from "react";
import { formatBytes } from "./utils";
import type { Folder, NoteListItem, StorageUsage, Tag } from "@/lib/api";
import type { ListMode, Panel } from "./workbenchTypes";

// ---------- "정리" 패널 (모드 / 폴더 / 태그 / 사용량 / export / 로그아웃) ----------

export type MobileNavCardProps = {
  mode: ListMode;
  setMode: (mode: ListMode) => void;
  setPanel: (panel: Panel) => void;
  selectedFolderId: string | undefined;
  setSelectedFolderId: (id: string | undefined) => void;
  selectedTagId: string | undefined;
  setSelectedTagId: (id: string | undefined) => void;
  debouncedQuery: string;
  folderOptions: Folder[];
  tags: Tag[];
  usage: StorageUsage | null;
  beginCreateFolder: (parentId: string | null) => void;
  handleCreateTag: () => void;
  handleExport: () => void;
  onLogout: () => void;
};

export function MobileNavCard(props: MobileNavCardProps): ReactElement {
  const {
    mode,
    setMode,
    setPanel,
    selectedFolderId,
    setSelectedFolderId,
    selectedTagId,
    setSelectedTagId,
    debouncedQuery,
    folderOptions,
    tags,
    usage,
    beginCreateFolder,
    handleCreateTag,
    handleExport,
    onLogout,
  } = props;
  return (
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
          <button
            type="button"
            className="text-xs text-sky-700 underline underline-offset-2"
            onClick={() => beginCreateFolder(null)}
          >
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
          <button
            type="button"
            className="text-xs text-sky-700 underline underline-offset-2"
            onClick={handleCreateTag}
          >
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
                  chosen
                    ? "border-ink-900 bg-ink-900 text-white"
                    : "border-transparent bg-white text-ink-900/75 ring-1 ring-ink-900/10"
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
}

// ---------- "목록" 패널 (검색 + 노트 리스트 + 새 노트 / 삭제 액션) ----------

export type MobileListCardProps = {
  mode: ListMode;
  notes: NoteListItem[];
  activeNoteId: string | undefined;
  query: string;
  onQueryChange: (q: string) => void;
  debouncedQuery: string;
  handleNewNote: () => void;
  loadNote: (id: string) => void;
  /** 일반 모드면 휴지통 이동 / 즐겨찾기 모드면 즐겨찾기 해제 등 컨텍스트 액션. */
  handleListItemAction: (note: NoteListItem) => void;
};

export function MobileListCard(props: MobileListCardProps): ReactElement {
  const {
    mode,
    notes,
    activeNoteId,
    query,
    onQueryChange,
    debouncedQuery,
    handleNewNote,
    loadNote,
    handleListItemAction,
  } = props;
  const listHeading =
    mode === "favorite" ? "즐겨찾기" : mode === "archive" ? "아카이브" : "목록";
  return (
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
          onChange={(ev) => onQueryChange(ev.target.value)}
          className="rounded-xl border border-ink-900/12 px-3 py-2 text-sm shadow-sm outline-none focus:border-sky-500"
        />
      </header>
      <ul className="flex-1 divide-y divide-ink-900/6 overflow-y-auto">
        {notes.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-ink-900/50">
            표시할 노트가 없습니다.
          </li>
        ) : null}
        {notes.map((n) => {
          const isActive = n.id === activeNoteId;
          return (
            <li
              key={n.id}
              className={`flex flex-col gap-1 px-4 py-3.5 hover:bg-white active:bg-white/80 ${
                isActive ? "bg-white shadow-inner" : "bg-transparent"
              }`}
            >
              <div
                role="button"
                tabIndex={0}
                className="flex cursor-pointer flex-col items-start gap-1 text-left outline-none focus:ring-2 focus:ring-sky-500/40"
                onClick={() => loadNote(n.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    loadNote(n.id);
                  }
                }}
              >
                <span className="line-clamp-1 text-[15px] font-semibold text-ink-900">
                  {n.is_favorite ? <span className="mr-1 text-yellow-500">★</span> : null}
                  {n.title || "무제 노트"}
                  {n.is_archived ? (
                    <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-700">
                      archive
                    </span>
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
                onClick={() => handleListItemAction(n)}
              >
                삭제
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
