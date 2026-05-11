/**
 * CodeMirror 확장이 React 리렌더와 분리되어 참조하는 모듈 전역 슬롯 + 문서
 * 캐럿 추적. 장기적으로는 factory 주입으로 대체 예정(ROADMAP §12).
 */

import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type EditorAuthContext = { token: string; apiUrl: string };
let __authCtx: EditorAuthContext | null = null;

export function setEditorAuthContext(ctx: EditorAuthContext | null): void {
  __authCtx = ctx;
}

export function getEditorAuthContext(): EditorAuthContext | null {
  return __authCtx;
}

type InsertFileFn = (file: File) => void;
let __insertFile: InsertFileFn | null = null;
export function setEditorInsertFile(fn: InsertFileFn | null): void {
  __insertFile = fn;
}

export function invokeInsertFile(file: File): void {
  __insertFile?.(file);
}

type NavigateLinkFn = (title: string) => void;
let __navigateLink: NavigateLinkFn | null = null;
export function setEditorNavigateLink(fn: NavigateLinkFn | null): void {
  __navigateLink = fn;
}

export function invokeNavigateLink(title: string): void {
  __navigateLink?.(title);
}

let __lastDocCursor = 0;
let __cursorEverExplicit = false;

export function getLastDocCursor(): number {
  return __lastDocCursor;
}

export function isLastDocCursorExplicit(): boolean {
  return __cursorEverExplicit;
}

export function resetLastDocCursor(): void {
  __lastDocCursor = 0;
  __cursorEverExplicit = false;
}

/** paste/drop 등에서도 사용 — 항상 최신 selection 과 doc 길이를 반영 */
export function syncCursorFromView(view: EditorView, markExplicit: boolean): void {
  syncLastDocCursorFromState(view.state);
  if (markExplicit) __cursorEverExplicit = true;
}

/** updateListener 경로: 위치만 갱신, explicit 플래그는 건드리지 않음 */
export function syncLastDocCursorFromState(state: EditorState): void {
  __lastDocCursor = Math.min(state.selection.main.from, state.doc.length);
}
