// 명령 팔레트 (Ctrl+K) 와 본문 슬래시(`/`) 메뉴에 뜨는 커맨드 정의를 모아둔다.
// MemoWorkbench 안에 인라인으로 두면 1500줄짜리 함수 본문의 가독성이 망가지고,
// 새로운 커맨드를 추가할 때마다 컴포넌트 본문이 부풀어서 분리한다.
//
// 핵심 설계:
//  - 두 빌더 함수는 모두 "deps" 객체 하나만 받아 배열을 반환하는 순수 함수다.
//  - state 와 핸들러의 소유는 여전히 MemoWorkbench 가 가지고, 호출 시점에
//    그대로 deps 로 넘긴다 (값/참조 변경이 잦아 useMemo 캐싱은 의미가 작음).
//  - todayNoteTitle 같은 가벼운 헬퍼는 빌더 안에서 직접 호출.
//  - 추후 단축키나 라벨이 늘어나면 같은 파일에 정의를 늘려가면 된다.

import { type Dispatch, type RefObject, type SetStateAction } from "react";
import { todayNoteTitle } from "./workbenchHelpers";
import type { AppCommand, SlashCommand } from "./workbenchTypes";

/** `appCommands` 빌더가 필요로 하는 외부 의존성. */
export type AppCommandDeps = {
  activeNoteId: string | undefined;
  drawingMode: boolean;
  rightPanel: "files" | "todos" | "versions" | "backlinks" | null;
  setRightPanel: (next: "files" | "todos" | "versions" | "backlinks" | null) => void;
  setDrawingMode: Dispatch<SetStateAction<boolean>>;
  setSidebarCollapsed: (next: boolean) => void;
  imageInputRef: RefObject<HTMLInputElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  handleNewNote: () => void | Promise<void>;
  handleOpenTodayNote: () => void | Promise<void>;
  handleExport: () => void | Promise<void>;
};

export function buildAppCommands(deps: AppCommandDeps): AppCommand[] {
  const {
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
  } = deps;
  return [
    {
      id: "new-note",
      title: "새 노트",
      description: "",
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
      id: "backlinks-panel",
      title: "백링크 보기",
      description: "이 노트를 [[제목]] 으로 참조하는 노트 목록",
      keywords: "backlink link reference 백링크 링크 참조",
      disabled: !activeNoteId,
      run: () => setRightPanel(rightPanel === "backlinks" ? null : "backlinks"),
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
}

/** `slashCommands` 빌더 deps. */
export type SlashCommandDeps = {
  imageInputRef: RefObject<HTMLInputElement | null>;
  setDrawingMode: Dispatch<SetStateAction<boolean>>;
  startAudioRecording: () => Promise<void> | void;
  /**
   * 활성 슬래시 토큰 (`/{query}`) 을 주어진 텍스트로 교체한다. 빈 문자열이면
   * 토큰만 지운다. 메뉴를 선택했을 때 호출되며, 메뉴 자체는 호출 측에서 닫는다.
   */
  replaceSlashCommand: (text: string) => void;
};

export function buildSlashCommands(deps: SlashCommandDeps): SlashCommand[] {
  const { imageInputRef, setDrawingMode, startAudioRecording, replaceSlashCommand } = deps;
  return [
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
}
