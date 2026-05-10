// Workbench 에서 공유하는 가벼운 타입 정의들. 컴포넌트가 4000줄 가까이 커지면서
// 같은 파일 안에서 타입을 찾기 어려워졌고, 외부 컴포넌트로 일부 JSX 를 분리할 때
// props 타입을 import 해 쓸 수 있도록 별도 파일로 옮긴다. 비즈니스 로직 / state 는
// 그대로 MemoWorkbench 안에 남는다.

/** 모바일 3패널 (정리 / 목록 / 편집) 식별자. */
export type Panel = "nav" | "list" | "editor";

/** 노트 리스트 모드: 일반 / 즐겨찾기 / 아카이브. */
export type ListMode = "active" | "favorite" | "archive";

/** 우측 "할 일" 패널이 들고 있는 한 줄짜리 체크리스트 항목. */
export type TodoPanelItem = {
  id: string;
  noteId: string;
  noteTitle: string;
  lineIndex: number;
  checked: boolean;
  text: string;
};

/**
 * 슬래시 커맨드 메뉴의 열림 상태 + 입력 쿼리.
 * - from / to: 슬래시 토큰 `(/?)?/{query}` 의 raw doc 좌표.
 *   메뉴를 열 때 잡아두고 클릭/Enter 시점에도 그대로 신뢰한다.
 * - x / y: 캐럿 위치의 뷰포트 픽셀 좌표 (메뉴를 그 옆에 띄움).
 */
export type SlashMenuState = {
  from: number;
  to: number;
  query: string;
  x: number;
  y: number;
} | null;

/** 사이드바에서 폴더 / 노트 / 빈 영역을 우클릭했을 때 뜨는 컨텍스트 메뉴. */
export type ContextMenuTarget =
  | { kind: "folder"; id: string; x: number; y: number }
  | { kind: "note"; id: string; x: number; y: number }
  | { kind: "blank"; x: number; y: number };

/** 사이드바 트리 위에 1초 호버 후 뜨는 메타 툴팁. */
export type HoverMeta = {
  kind: "folder" | "note";
  id: string;
  label: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  folderCount?: number;
  noteCount?: number;
  x: number;
  y: number;
};

/** 삭제 등 위험한 동작 전에 띄우는 확인 모달의 표시 상태. */
export type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
} | null;

/** 명령 팔레트(Ctrl+K) 한 줄 항목. */
export type AppCommand = {
  id: string;
  title: string;
  description: string;
  shortcut?: string;
  keywords: string;
  disabled?: boolean;
  run: () => void;
};
