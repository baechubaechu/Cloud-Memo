// 본문 캐럿 위치에 텍스트·첨부 마커를 넣는 함수들. Workbench 에서 분리.
//
// 캐럿 위치 결정 규칙(아래 우선순위):
//   1) 호출부가 위치를 정해 준 경우(끌어다 놓기) 그대로 따른다.
//   2) 본문에 포커스가 살아 있으면 view.state.selection 을 그대로 쓴다.
//      (=화면에서 깜빡이는 캐럿)
//   3) 본문에서 한 번이라도 사용자가 명시적으로 캐럿을 둔 적이 있으면
//      그 마지막 위치(__lastDocCursor) 를 쓴다.
//   4) 위 조건 다 아니면(예: 새 노트 열자마자 툴바 버튼만 누른 경우)
//      문서 끝에 append. 예전엔 이 경우에도 0(=최상단) 으로 박혀버려서
//      "이미지 위치가 항상 최상단" 처럼 보였음.

import type { EditorView } from "@codemirror/view";
import { getLastDocCursor, isLastDocCursorExplicit } from "./editorGlobals";

function chooseInsertPos(view: EditorView, at?: number): number {
  const doc = view.state.doc;
  let chosen: number;
  if (at !== undefined) chosen = at;
  else if (view.hasFocus) chosen = view.state.selection.main.from;
  else if (isLastDocCursorExplicit()) chosen = getLastDocCursor();
  else chosen = doc.length;
  return Math.min(Math.max(0, chosen), doc.length);
}

function insertAt(view: EditorView, pos: number, insertText: string): void {
  view.dispatch({
    changes: { from: pos, to: pos, insert: insertText },
    selection: { anchor: pos + insertText.length },
    scrollIntoView: true,
  });
  view.focus();
}

/** 캐럿 위치에 첨부 마커를 한 줄로 넣는다 (줄 중간이면 앞에서 줄을 바꾼다). */
export function insertMarkerAtCursor(view: EditorView | null, marker: string, at?: number): boolean {
  if (!view) return false;
  const pos = chooseInsertPos(view, at);
  const atLineStart = pos === view.state.doc.lineAt(pos).from;
  insertAt(view, pos, `${atLineStart ? "" : "\n"}${marker}\n`);
  return true;
}

/** 캐럿 위치에 텍스트를 그대로 넣는다. */
export function insertTextAtCursor(view: EditorView | null, insertText: string): boolean {
  if (!view) return false;
  insertAt(view, chooseInsertPos(view), insertText);
  return true;
}

/** 업로드한 첨부를 본문에 넣을 마커. 이미지·오디오는 미리보기로 그려진다. */
export function buildAttachmentMarker(att: { id: string; original_filename: string; kind?: string }): string {
  const safeName = att.original_filename.replaceAll("]", "").replaceAll("[", "");
  if (att.kind === "image") return `![${safeName}](attachment://${att.id})`;
  if (att.kind === "audio") return `![audio:${safeName}](attachment://${att.id})`;
  return `[${safeName}](attachment://${att.id})`;
}
