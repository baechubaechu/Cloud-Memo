/**
 * 단일 활성 에디터의 "마지막 본문 캐럿" 추적. 툴바에서 첨부 마커를 넣을 때
 * `editorViewRef` 와 함께 쓰인다. Facet 과 별개로 유지 (React 쪽에서 view 없이
 * 조회할 수 있어야 함).
 */

import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

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

export function syncCursorFromView(view: EditorView, markExplicit: boolean): void {
  syncLastDocCursorFromState(view.state);
  if (markExplicit) __cursorEverExplicit = true;
}

export function syncLastDocCursorFromState(state: EditorState): void {
  __lastDocCursor = Math.min(state.selection.main.from, state.doc.length);
}
