// 데스크톱 옵시디언 풍 레이아웃 우측 토글 패널 (첨부 / 할 일 / 버전).
// MemoWorkbench 가 활성 노트와 패널 키 (`rightPanel`) 가 있을 때만 이 컴포넌트를
// 그린다. 컴포넌트 내부에서는 항상 활성 노트 + 패널이 있다고 가정한다.

import { type ReactElement } from "react";
import { IconX } from "./Icons";
import { AuthenticatedImagePreview } from "./AuthenticatedImagePreview";
import { REASON_LABEL, formatBytes } from "./utils";
import type { Attachment, NoteDetail, NoteVersion } from "@/lib/api";
import type { TodoPanelItem } from "./workbenchTypes";

export type RightPanelKind = "files" | "todos" | "versions";

export type WorkbenchRightPanelProps = {
  activeNote: NoteDetail;
  rightPanel: RightPanelKind;
  setRightPanel: (next: RightPanelKind | null) => void;
  token: string;
  handleUpload: (files: FileList | null) => Promise<void> | void;
  handleDeleteAttachment: (attachment: Attachment) => Promise<void> | void;
  todoItems: TodoPanelItem[];
  todoLoading: boolean;
  refreshTodoItems: () => Promise<void> | void;
  toggleTodoFromPanel: (item: TodoPanelItem) => Promise<void> | void;
  loadNote: (id: string) => Promise<void> | void;
  versions: NoteVersion[];
  handleRestoreVersion: (version: NoteVersion) => Promise<void> | void;
};

export function WorkbenchRightPanel(props: WorkbenchRightPanelProps): ReactElement {
  const {
    activeNote,
    rightPanel,
    setRightPanel,
    token,
    handleUpload,
    handleDeleteAttachment,
    todoItems,
    todoLoading,
    refreshTodoItems,
    toggleTodoFromPanel,
    loadNote,
    versions,
    handleRestoreVersion,
  } = props;

  return (
    <aside className="flex h-full min-w-0 flex-col border-l border-ink-900/10 bg-[#fafaf9]">
      <header className="flex h-9 items-center gap-1 border-b border-ink-900/10 px-2 text-[12px]">
        <button
          type="button"
          onClick={() => setRightPanel("files")}
          className={`rounded px-2 py-0.5 ${
            rightPanel === "files" ? "bg-black/10 text-ink-900" : "text-ink-900/55 hover:bg-black/5"
          }`}
        >
          첨부
        </button>
        <button
          type="button"
          onClick={() => setRightPanel("versions")}
          className={`rounded px-2 py-0.5 ${
            rightPanel === "versions" ? "bg-black/10 text-ink-900" : "text-ink-900/55 hover:bg-black/5"
          }`}
        >
          버전
        </button>
        <button
          type="button"
          onClick={() => setRightPanel("todos")}
          className={`rounded px-2 py-0.5 ${
            rightPanel === "todos" ? "bg-black/10 text-ink-900" : "text-ink-900/55 hover:bg-black/5"
          }`}
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
          <FilesPanel
            activeNote={activeNote}
            token={token}
            handleUpload={handleUpload}
            handleDeleteAttachment={handleDeleteAttachment}
          />
        ) : rightPanel === "todos" ? (
          <TodosPanel
            todoItems={todoItems}
            todoLoading={todoLoading}
            refreshTodoItems={refreshTodoItems}
            toggleTodoFromPanel={toggleTodoFromPanel}
            loadNote={loadNote}
          />
        ) : (
          <VersionsPanel versions={versions} handleRestoreVersion={handleRestoreVersion} />
        )}
      </div>
    </aside>
  );
}

// ---------- 첨부 ----------

function FilesPanel(props: {
  activeNote: NoteDetail;
  token: string;
  handleUpload: (files: FileList | null) => Promise<void> | void;
  handleDeleteAttachment: (attachment: Attachment) => Promise<void> | void;
}): ReactElement {
  const { activeNote, token, handleUpload, handleDeleteAttachment } = props;
  const liveAttachments = activeNote.attachments.filter((a) => !a.deleted_at);
  return (
    <div className="space-y-3">
      <label className="block w-full cursor-pointer rounded border border-dashed border-ink-900/20 bg-white/50 px-3 py-2 text-center text-[12px] text-ink-900/60 hover:bg-white">
        파일 업로드
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(ev) => {
            void handleUpload(ev.target.files);
          }}
        />
      </label>
      {liveAttachments.length === 0 ? (
        <p className="text-[12px] text-ink-900/45">
          첨부가 없습니다. 이미지·오디오·일반 파일 모두 가능합니다.
        </p>
      ) : (
        liveAttachments.map((att) => (
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
              onClick={() => {
                void handleDeleteAttachment(att);
              }}
            >
              제거
            </button>
          </div>
        ))
      )}
    </div>
  );
}

// ---------- 할 일 ----------

function TodosPanel(props: {
  todoItems: TodoPanelItem[];
  todoLoading: boolean;
  refreshTodoItems: () => Promise<void> | void;
  toggleTodoFromPanel: (item: TodoPanelItem) => Promise<void> | void;
  loadNote: (id: string) => Promise<void> | void;
}): ReactElement {
  const { todoItems, todoLoading, refreshTodoItems, toggleTodoFromPanel, loadNote } = props;
  return (
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
          onClick={() => {
            void refreshTodoItems();
          }}
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
            .sort(
              (a, b) =>
                Number(a.checked) - Number(b.checked) || a.noteTitle.localeCompare(b.noteTitle),
            )
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
                    onClick={() => {
                      void toggleTodoFromPanel(item);
                    }}
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
                    onClick={() => {
                      void loadNote(item.noteId);
                    }}
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
  );
}

// ---------- 버전 ----------

function VersionsPanel(props: {
  versions: NoteVersion[];
  handleRestoreVersion: (version: NoteVersion) => Promise<void> | void;
}): ReactElement {
  const { versions, handleRestoreVersion } = props;
  if (versions.length === 0) {
    return <p className="text-[12px] text-ink-900/45">아직 저장된 버전이 없습니다.</p>;
  }
  return (
    <div className="space-y-2">
      {versions.slice(0, 32).map((v) => (
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
              onClick={() => {
                void handleRestoreVersion(v);
              }}
            >
              되돌리기
            </button>
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] text-ink-900/65">{v.title}</p>
        </article>
      ))}
    </div>
  );
}
