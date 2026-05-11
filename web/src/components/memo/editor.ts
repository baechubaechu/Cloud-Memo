/**
 * CodeMirror 하이브리드 마크다운 에디터 — 공개 API 진입점.
 * 구현은 `editor*.ts` 모듈로 분리되어 있다.
 */

export {
  getLastDocCursor,
  isLastDocCursorExplicit,
  resetLastDocCursor,
} from "./editorGlobals";

export type { MemoEditorContext } from "./editorContext";
export {
  memoEditorContextExtension,
  getMemoEditorContext,
  createMemoEditorExtensions,
} from "./editorContext";

export { editorCursorTracker, editorCursorBackupSync } from "./editorCursor";

export { hybridMarkdownField } from "./editorDecorations";

export {
  applyInlineHighlight,
  ChecklistPrefixWidget,
  QuotePrefixWidget,
  WikilinkInlineWidget,
  RenderedMarkdownLineWidget,
} from "./editorWidgets";

export { editorMediaInputHandlers } from "./editorMediaInput";
export { editorMouseHandlers } from "./editorMouseHandlers";

export {
  editorNavAndDeleteKeymap,
  editorQuoteEnterKeymap,
  editorUndoRedoKeymap,
  editorChecklistAutoTrigger,
} from "./editorKeymaps";

export { cmEditorVisualTheme } from "./editorTheme";

export { isAttachmentLineText, removeWholeAttachmentLine } from "./editorAttachmentLine";
