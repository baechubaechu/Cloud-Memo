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

  /* 위키링크 `[[` 자동완성 — CommandPalette.tsx 와 동일 톤(rounded-2xl, ink, 제목/설명 세로 스택) */
  ".cm-tooltip-autocomplete.memo-wikilink-completion": {
    borderRadius: "1rem",
    border: "1px solid rgba(16, 23, 39, 0.12)",
    backgroundColor: "rgb(255 255 255)",
    boxShadow:
      "0 25px 50px -12px rgba(11, 16, 32, 0.18), 0 12px 24px -8px rgba(11, 16, 32, 0.1)",
    fontFamily:
      '"Pretendard", var(--font-ui), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
    WebkitFontSmoothing: "antialiased",
    minWidth: "20rem",
    maxWidth: "min(36rem, 94vw)",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete.memo-wikilink-completion ul": {
    fontFamily: "inherit",
    margin: "0",
    padding: "0.5rem",
    listStyle: "none",
    maxHeight: "min(50vh, 22rem)",
    overflowY: "auto",
    scrollbarWidth: "thin",
    scrollbarColor: "rgba(15, 23, 42, 0.22) transparent",
  },
  ".cm-tooltip-autocomplete.memo-wikilink-completion ul::-webkit-scrollbar": {
    width: "8px",
  },
  ".cm-tooltip-autocomplete.memo-wikilink-completion ul::-webkit-scrollbar-thumb": {
    backgroundColor: "rgba(15, 23, 42, 0.22)",
    borderRadius: "9999px",
  },
  /* 팔레트 버튼과 같이: 세로로 제목 → 부가설명(기존 노트 등), 시원한 줄간격 */
  ".cm-tooltip-autocomplete.memo-wikilink-completion li": {
    margin: "0",
    padding: "0.7rem 0.75rem",
    borderRadius: "0.75rem",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "center",
    gap: "0.45rem",
    color: "#101727",
    lineHeight: "1.5",
    minHeight: "3.5rem",
  },
  ".cm-tooltip-autocomplete.memo-wikilink-completion li:hover": {
    backgroundColor: "rgb(249 250 251)",
  },
  /* 선택 = 색이 아니라 회색만 진하게 (의미 구분은 명도) */
  ".cm-tooltip-autocomplete.memo-wikilink-completion li[aria-selected]": {
    backgroundColor: "rgb(229 231 235)",
    color: "#101727",
    boxShadow: "inset 0 0 0 1px rgba(16, 23, 39, 0.1)",
  },
  ".cm-tooltip-autocomplete.memo-wikilink-completion li.memo-wikilink-completion-new": {
    boxShadow: "inset 3px 0 0 0 rgba(16, 23, 39, 0.22)",
    paddingLeft: "0.85rem",
  },
  ".cm-tooltip-autocomplete.memo-wikilink-completion li.memo-wikilink-completion-new[aria-selected]": {
    boxShadow:
      "inset 3px 0 0 0 rgba(16, 23, 39, 0.35), inset 0 0 0 1px rgba(16, 23, 39, 0.1)",
  },
  /* CommandPalette 명령 제목: text-[14px] font-semibold text-ink-900 */
  ".cm-tooltip-autocomplete.memo-wikilink-completion .cm-completionLabel": {
    display: "block",
    fontSize: "14px",
    fontWeight: "600",
    fontStyle: "normal",
    letterSpacing: "0",
    lineHeight: "1.45",
    color: "#101727",
    width: "100%",
    fontFamily: "inherit",
    fontSynthesis: "none",
  },
  /* CM 기본 .cm-completionDetail { fontStyle: italic } 를 꼭 덮어써서 본문과 같은 산세리프로 통일 */
  ".cm-tooltip-autocomplete.memo-wikilink-completion .cm-completionDetail": {
    display: "block",
    fontSize: "12px",
    fontWeight: "400",
    fontStyle: "normal",
    lineHeight: "1.5",
    color: "rgba(16, 23, 39, 0.45)",
    width: "100%",
    marginLeft: "0",
    whiteSpace: "normal",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
    fontFamily: "inherit",
    fontSynthesis: "none",
  },
  ".cm-tooltip-autocomplete.memo-wikilink-completion li[aria-selected] .cm-completionLabel": {
    color: "#101727",
  },
  ".cm-tooltip-autocomplete.memo-wikilink-completion li[aria-selected] .cm-completionDetail": {
    color: "rgba(16, 23, 39, 0.52)",
  },
  ".cm-tooltip-autocomplete.memo-wikilink-completion .cm-completionMatchedText": {
    color: "rgba(16, 23, 39, 0.72)",
    fontWeight: "700",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  ".cm-tooltip-autocomplete.memo-wikilink-completion li[aria-selected] .cm-completionMatchedText": {
    color: "rgba(16, 23, 39, 0.88)",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  ".cm-tooltip-autocomplete.memo-wikilink-completion .cm-tooltip.cm-completionInfo": {
    borderRadius: "0.75rem",
    border: "1px solid rgba(16, 23, 39, 0.12)",
    backgroundColor: "rgb(255 255 255)",
    padding: "0.65rem 0.85rem",
    fontSize: "12px",
    lineHeight: "1.5",
    color: "rgba(16, 23, 39, 0.75)",
    fontFamily: "inherit",
    boxShadow: "0 12px 24px -8px rgba(11, 16, 32, 0.12)",
  },
});
