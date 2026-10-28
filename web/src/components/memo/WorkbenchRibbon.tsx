// 데스크톱 왼쪽 세로 아이콘 막대: 사이드바 접기, 새 노트, 목록 모드(전체·즐겨찾기·아카이브),
// 템플릿 관리, 로그아웃. props 만 받는 표시용. Workbench 에서 분리.

import type { ReactElement } from "react";
import { IconArchive, IconFile, IconList, IconLogOut, IconPlus, IconSidebarToggle, IconStar } from "./Icons";
import type { ListMode } from "./workbenchTypes";

const RIBBON_MODES: Array<{ key: ListMode; label: string; Icon: typeof IconList }> = [
  { key: "active", label: "전체", Icon: IconList },
  { key: "favorite", label: "즐겨찾기", Icon: IconStar },
  { key: "archive", label: "아카이브", Icon: IconArchive },
];

type Props = {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  /** 검색 중에는 새 노트를 만들지 않는다. */
  newNoteDisabled: boolean;
  onNewNote: () => void;
  mode: ListMode;
  onModeChange: (mode: ListMode) => void;
  onOpenTemplates: () => void;
  onLogout: () => void;
};

export function WorkbenchRibbon(props: Props): ReactElement {
  const { sidebarCollapsed, onToggleSidebar, newNoteDisabled, onNewNote, mode, onModeChange, onOpenTemplates, onLogout } = props;
  return (
    <div className="flex h-full w-11 flex-col items-center gap-1 border-r border-ink-900/10 bg-[#f4f4f3] py-2 text-ink-900/55">
      <button
        type="button"
        title={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
        aria-label={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
        onClick={onToggleSidebar}
        className="grid h-8 w-8 place-items-center rounded-md hover:bg-black/5 hover:text-ink-900"
      >
        <IconSidebarToggle size={16} />
      </button>
      <div className="my-1 h-[1px] w-6 bg-ink-900/10" />
      <button
        type="button"
        title="새 노트"
        aria-label="새 노트"
        disabled={newNoteDisabled}
        onClick={onNewNote}
        className="grid h-8 w-8 place-items-center rounded-md hover:bg-black/5 hover:text-ink-900 disabled:opacity-30"
      >
        <IconPlus size={16} />
      </button>
      {RIBBON_MODES.map((m) => {
        const isOn = mode === m.key;
        const Icon = m.Icon;
        return (
          <button
            key={m.key}
            type="button"
            title={m.label}
            aria-label={m.label}
            onClick={() => onModeChange(m.key)}
            className={`grid h-8 w-8 place-items-center rounded-md ${
              isOn ? "bg-black/10 text-ink-900" : "hover:bg-black/5 hover:text-ink-900"
            }`}
          >
            <Icon size={16} />
          </button>
        );
      })}
      <button type="button" title="노트 템플릿" aria-label="노트 템플릿" onClick={onOpenTemplates} className="grid h-8 w-8 place-items-center rounded-md hover:bg-black/5 hover:text-ink-900"><IconFile size={16} /></button>
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
}
