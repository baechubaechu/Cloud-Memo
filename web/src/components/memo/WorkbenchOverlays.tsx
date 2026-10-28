// Workbench 의 작은 오버레이 UI 묶음. 각 컴포넌트는 props 만 받는 순수 표시용.
// 상태 (= 어떤 폴더를 우클릭했는지, 어떤 항목 위에 호버 중인지 등) 와 콜백
// (= 새 노트 / 폴더 생성, 이름 변경, 삭제 등) 은 모두 부모(MemoWorkbench 와 그 훅들)
// 가 가지고 있다.

import { formatDateTime } from "./utils";
import type { ConfirmDialogState, ContextMenuTarget, HoverMeta } from "./workbenchTypes";

// ---------- 컨텍스트 메뉴 ----------

type ContextMenuProps = {
  target: ContextMenuTarget | null;
  onClose: () => void;
  /** 빈 공간 우클릭 → 새 노트 */
  onNewRootNote: () => void;
  /** 빈 공간 우클릭 → 새 폴더 (parent=null) */
  onNewRootFolder: () => void;
  /** 폴더 우클릭 → 이 폴더에 새 노트 */
  onNewNoteIn: (folderId: string) => void;
  /** 폴더 우클릭 → 새 하위 폴더 */
  onNewSubfolder: (folderId: string) => void;
  /** 폴더 우클릭 → 이름 변경 */
  onRenameFolder: (folderId: string) => void;
  /** 폴더 우클릭 → 폴더 삭제 */
  onDeleteFolder: (folderId: string) => void;
  /** 노트 우클릭 → 이름 변경 */
  onRenameNote: (noteId: string) => void;
  /** 노트 우클릭 → 삭제 */
  onDeleteNote: (noteId: string) => void;
};

export function ContextMenu({
  target,
  onClose,
  onNewRootNote,
  onNewRootFolder,
  onNewNoteIn,
  onNewSubfolder,
  onRenameFolder,
  onDeleteFolder,
  onRenameNote,
  onDeleteNote,
}: ContextMenuProps) {
  if (!target) return null;
  return (
    <div
      id="tree-context-menu"
      className="fixed z-50 min-w-[180px] overflow-hidden rounded-md border border-ink-900/15 bg-white py-1 text-[13px] shadow-lg"
      style={{ left: target.x, top: target.y }}
    >
      {target.kind === "blank" ? (
        <>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left hover:bg-black/5"
            onClick={() => {
              onClose();
              onNewRootNote();
            }}
          >
            새 노트
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left hover:bg-black/5"
            onClick={() => {
              onClose();
              onNewRootFolder();
            }}
          >
            새 폴더
          </button>
        </>
      ) : target.kind === "folder" ? (
        <>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left hover:bg-black/5"
            onClick={() => {
              const id = target.id;
              onClose();
              onNewNoteIn(id);
            }}
          >
            이 폴더에 새 노트
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left hover:bg-black/5"
            onClick={() => {
              const id = target.id;
              onClose();
              onNewSubfolder(id);
            }}
          >
            새 하위 폴더
          </button>
          <div className="my-1 h-px bg-ink-900/10" />
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left hover:bg-black/5"
            onClick={() => {
              const id = target.id;
              onClose();
              onRenameFolder(id);
            }}
          >
            이름 변경
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
            onClick={() => {
              const id = target.id;
              onClose();
              onDeleteFolder(id);
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
              const id = target.id;
              onClose();
              onRenameNote(id);
            }}
          >
            이름 변경
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
            onClick={() => {
              const id = target.id;
              onClose();
              onDeleteNote(id);
            }}
          >
            삭제
          </button>
        </>
      )}
    </div>
  );
}

// ---------- 호버 툴팁 ----------

export function HoverTooltip({ meta }: { meta: HoverMeta | null }) {
  if (!meta) return null;
  return (
    <div
      className="pointer-events-none fixed z-[60] max-w-[280px] rounded-md border border-ink-900/20 bg-white/95 px-2.5 py-2 text-[12px] text-ink-900 shadow-lg backdrop-blur"
      style={{ left: meta.x + 14, top: meta.y + 14 }}
    >
      <p className="mb-1 truncate font-semibold">{meta.label}</p>
      {meta.kind === "folder" ? (
        <>
          <p className="text-ink-900/70">하위 폴더: {meta.folderCount ?? 0}개</p>
          <p className="text-ink-900/70">파일: {meta.noteCount ?? 0}개</p>
        </>
      ) : (
        <>
          <p className="text-ink-900/70">생성: {formatDateTime(meta.createdAt)}</p>
          <p className="text-ink-900/70">수정: {formatDateTime(meta.updatedAt)}</p>
        </>
      )}
    </div>
  );
}

// ---------- 확인 다이얼로그 ----------

type ConfirmDialogProps = {
  state: ConfirmDialogState;
  onResolve: (ok: boolean) => void;
};

export function ConfirmDialog({ state, onResolve }: ConfirmDialogProps) {
  if (!state) return null;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/30 p-4">
      <div role="dialog" aria-modal="true" aria-label={state.title} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onResolve(false); }
        if (event.key === "Tab") {
          const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl ring-1 ring-ink-900/15">
        <h3 className="text-[15px] font-semibold text-ink-900">{state.title}</h3>
        <p className="mt-2 whitespace-pre-line text-[13px] text-ink-900/75">{state.message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            className="rounded-md border border-ink-900/20 px-3 py-1.5 text-[12px] text-ink-900/75 hover:bg-black/5"
            onClick={() => onResolve(false)}
          >
            취소
          </button>
          <button
            type="button"
            className="rounded-md bg-red-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-red-700"
            onClick={() => onResolve(true)}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 상단 알림 줄: 링크 갱신 알림, 오프라인, 경고 ----------

type StatusBannersProps = {
  /** 이름·경로 변경으로 링크를 고친 노트 수 (잠깐 떴다 사라진다). */
  linkNotice: { count: number } | null;
  offline: boolean;
  /** 이 기기에 노트 사본을 보관 중인지 (오프라인 문구가 달라진다). */
  keepsDeviceCopy: boolean;
  warning: string | null;
  onDismissWarning: () => void;
};

export function StatusBanners({ linkNotice, offline, keepsDeviceCopy, warning, onDismissWarning }: StatusBannersProps) {
  return (
    <>
      {linkNotice ? (
        <div role="status" aria-live="polite" className="pointer-events-none fixed left-1/2 top-4 z-50 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-md border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-800 shadow-lg">
          {linkNotice.count > 0
            ? `${linkNotice.count}개 노트의 링크가 변경되었습니다.`
            : "이름·경로가 변경되었습니다. 갱신할 링크는 없습니다."}
        </div>
      ) : null}
      {offline ? (
        <div className="border-b border-slate-300 bg-slate-100 px-4 py-1.5 text-[12px] text-slate-700">
          {keepsDeviceCopy
            ? "오프라인 — 이 기기에 보관한 사본으로 작업 중입니다. 고친 내용은 연결되면 서버에 반영됩니다."
            : "오프라인 — 서버에 연결할 수 없습니다. 이 기기는 노트 보관이 꺼져 있어, 지금 열린 노트만 이어서 쓸 수 있고 연결되면 저장됩니다."}
        </div>
      ) : null}
      {warning ? (
        <div className="border-b border-amber-400/40 bg-amber-50 px-4 py-2 text-[13px] text-amber-900">
          ⚠️ {warning}
          <button type="button" className="float-right ml-4 text-[11px] font-semibold" onClick={onDismissWarning}>
            숨김
          </button>
        </div>
      ) : null}
    </>
  );
}
