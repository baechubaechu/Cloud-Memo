// 명령 팔레트(Ctrl+K / Ctrl+P) 오버레이. 상태/명령 목록은 부모(MemoWorkbench)
// 가 가지고 있고, 이 컴포넌트는 순수 표시용. 메뉴 항목 실행 후 닫는 책임은
// 부모에서 넘겨준 onClose 가 진다.

import { type RefObject } from "react";
import type { AppCommand } from "./workbenchTypes";

type Props = {
  open: boolean;
  query: string;
  onQueryChange: (next: string) => void;
  filteredCommands: AppCommand[];
  inputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  /** 항목을 실제로 실행 (그리고 부모가 닫기 + query 초기화 같이 처리). */
  onRun: (cmd: AppCommand) => void;
};

export function CommandPalette({
  open,
  query,
  onQueryChange,
  filteredCommands,
  inputRef,
  onClose,
  onRun,
}: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[90] bg-black/20 p-4 backdrop-blur-[1px]"
      onMouseDown={onClose}
    >
      <div
        className="mx-auto mt-[10vh] w-full max-w-xl overflow-hidden rounded-2xl border border-ink-900/12 bg-white shadow-2xl"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <div className="border-b border-ink-900/10 p-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(ev) => onQueryChange(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Escape") {
                ev.preventDefault();
                onClose();
                return;
              }
              if (ev.key === "Enter") {
                ev.preventDefault();
                const cmd = filteredCommands.find((x) => !x.disabled);
                if (!cmd) return;
                onRun(cmd);
              }
            }}
            placeholder="명령 검색... 새 노트, 오늘 노트, 이미지, 그리기"
            className="h-11 w-full rounded-xl border border-ink-900/10 bg-[#fafaf9] px-3 text-[15px] outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {filteredCommands.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-ink-900/45">
              일치하는 명령이 없습니다.
            </p>
          ) : (
            filteredCommands.map((cmd) => (
              <button
                key={cmd.id}
                type="button"
                disabled={cmd.disabled}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => onRun(cmd)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-ink-900">
                    {cmd.title}
                  </span>
                  <span className="block truncate text-[12px] text-ink-900/45">
                    {cmd.description}
                  </span>
                </span>
                {cmd.shortcut ? (
                  <span className="shrink-0 rounded border border-ink-900/10 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-ink-900/45">
                    {cmd.shortcut}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
        <div className="border-t border-ink-900/8 px-3 py-2 text-[11px] text-ink-900/40">
          Enter 실행 · Esc 닫기 · Ctrl+K / Ctrl+P 열기
        </div>
      </div>
    </div>
  );
}
