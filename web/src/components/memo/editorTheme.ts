import { EditorView } from "@codemirror/view";

export const cmEditorVisualTheme = EditorView.theme({
  "&.cm-editor": {
    backgroundColor: "transparent",
    fontFamily: "inherit",
  },
  "&.cm-editor.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "visible",
    fontFamily: "inherit",
    lineHeight: "inherit",
  },
  ".cm-content, .cm-line": {
    fontFamily: "inherit",
  },
  ".cm-line": {
    padding: "0 !important",
  },
  ".cm-line.cm-heading-l1": {
    fontSize: "1.875rem",
    fontWeight: "600",
    lineHeight: "1.25",
  },
  ".cm-line.cm-heading-l2": {
    fontSize: "1.5rem",
    fontWeight: "600",
    lineHeight: "1.3",
  },
  ".cm-line.cm-heading-l3": {
    fontSize: "1.25rem",
    fontWeight: "600",
    lineHeight: "1.35",
  },
  ".cm-line.cm-heading-l4": {
    fontSize: "1.125rem",
    fontWeight: "600",
    lineHeight: "1.4",
  },
  ".cm-line.memo-quote-line": {
    borderLeft: "3px solid rgba(15,17,28,0.2)",
    paddingLeft: "0.6rem !important",
    color: "rgba(15,17,28,0.78)",
    fontStyle: "italic",
  },
  ".memo-quote-prefix": {
    display: "inline-block",
    width: "0",
    overflow: "hidden",
  },
  ".cm-header, .cm-formatting-header": {
    textDecoration: "none !important",
    borderBottom: "none !important",
  },
  ".cm-line.cm-heading-l1, .cm-line.cm-heading-l1 *": {
    textDecoration: "none !important",
    borderBottom: "none !important",
    boxShadow: "none !important",
  },
  ".cm-line.cm-heading-l2, .cm-line.cm-heading-l2 *": {
    textDecoration: "none !important",
    borderBottom: "none !important",
    boxShadow: "none !important",
  },
  ".cm-line.cm-heading-l3, .cm-line.cm-heading-l3 *": {
    textDecoration: "none !important",
    borderBottom: "none !important",
    boxShadow: "none !important",
  },
  ".cm-line.cm-heading-l4, .cm-line.cm-heading-l4 *": {
    textDecoration: "none !important",
    borderBottom: "none !important",
    boxShadow: "none !important",
  },
  ".cm-content:focus-visible": {
    outline: "none",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  ".cm-selectionBackground": {
    backgroundColor: "transparent !important",
  },
  ".cm-focused .cm-selectionBackground": {
    backgroundColor: "transparent !important",
  },
  ".memo-selection": {
    backgroundColor: "#cfd0e8",
    borderRadius: "2px",
  },
  ".memo-checklist-text-checked": {
    textDecoration: "line-through",
    color: "rgba(15, 23, 42, 0.45)",
  },
  ".memo-checklist-prefix": {
    userSelect: "none",
  },
  ".memo-image-toolbar": {
    display: "none",
  },
  ".memo-image-resize-handle": {
    display: "none",
  },
  ".memo-image-remove": {
    display: "none",
  },
  ".memo-image-block.is-selected .memo-image-toolbar": {
    display: "inline-flex",
  },
  ".memo-image-block.is-selected .memo-image-resize-handle": {
    display: "block",
  },
  ".memo-image-block.is-selected .memo-image-remove": {
    display: "grid",
  },
  ".memo-image-block.is-selected": {
    outline: "2px solid #6366f1",
    outlineOffset: "2px",
    borderRadius: "0.5rem",
  },
});
