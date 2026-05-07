import { StateField, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import { getRenderedOffset, headingLevelClass, renderMarkdownLineHtml } from "./markdown";

// 렌더된 텍스트 element 안에서 [from, to] 글자 범위를 inline span으로 감싸 하이라이트 표시.
export function applyInlineHighlight(text: HTMLElement, from: number, to: number): void {
  if (to <= from) return;
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let cursor = 0;
  for (const node of nodes) {
    const len = node.data.length;
    const nodeStart = cursor;
    const nodeEnd = cursor + len;
    cursor = nodeEnd;
    const start = Math.max(0, from - nodeStart);
    const end = Math.min(len, to - nodeStart);
    if (start >= end) continue;
    let target: Text = node;
    if (start > 0) target = target.splitText(start);
    if (end - start < target.data.length) target.splitText(end - start);
    const wrap = document.createElement("span");
    wrap.style.backgroundColor = "#cfd0e8";
    wrap.style.borderRadius = "2px";
    target.parentNode?.insertBefore(wrap, target);
    wrap.appendChild(target);
  }
}

export class RenderedMarkdownLineWidget extends WidgetType {
  constructor(
    readonly rawLine: string,
    readonly lineFrom: number,
    readonly highlightFrom: number,
    readonly highlightTo: number,
  ) {
    super();
  }

  eq(other: RenderedMarkdownLineWidget): boolean {
    return (
      this.rawLine === other.rawLine &&
      this.lineFrom === other.lineFrom &&
      this.highlightFrom === other.highlightFrom &&
      this.highlightTo === other.highlightTo
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("div");
    el.className = "cursor-text px-0 py-0 text-[15px] leading-6 text-ink-900";
    el.style.width = "100%";
    el.style.userSelect = "none";
    const lineNum = view.state.doc.lineAt(this.lineFrom).number;
    el.setAttribute("data-cm-widget-line", String(lineNum));
    const text = document.createElement("span");
    text.className = "inline";
    text.innerHTML = renderMarkdownLineHtml(this.rawLine);
    el.appendChild(text);
    if (this.highlightTo > this.highlightFrom) {
      const renderedFrom = getRenderedOffset(this.rawLine, this.highlightFrom);
      const renderedTo = getRenderedOffset(this.rawLine, this.highlightTo);
      applyInlineHighlight(text, renderedFrom, renderedTo);
    }
    const lineFrom = this.lineFrom;
    const lineTo = this.lineFrom + this.rawLine.length;
    const resolveAnchorInThisLine = (clientX: number, clientY: number): number => {
      const rect = el.getBoundingClientRect();
      const textRect = text.getBoundingClientRect();
      const posAt = view.posAtCoords({ x: clientX, y: clientY });
      const effectiveTextRight = Math.max(rect.left, textRect.right);
      if (clientX >= effectiveTextRight + 1) return lineTo;
      const lineEndCoords = view.coordsAtPos(lineTo);
      if (lineEndCoords && clientX >= lineEndCoords.right - 4) return lineTo;
      if (typeof posAt === "number") {
        if (posAt < lineFrom) return lineFrom;
        if (posAt > lineTo) return lineTo;
        return posAt;
      }
      return lineFrom;
    };
    const resolveDocPos = (clientX: number, clientY: number, fallback: number): number => {
      const posAt = view.posAtCoords({ x: clientX, y: clientY });
      if (typeof posAt === "number") return posAt;
      return fallback;
    };
    el.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      if (ev.detail >= 2) {
        view.dispatch({
          selection: { anchor: lineFrom, head: lineTo },
          scrollIntoView: true,
        });
        view.focus();
        return;
      }
      const anchor = resolveAnchorInThisLine(ev.clientX, ev.clientY);
      view.dispatch({
        selection: { anchor },
        scrollIntoView: true,
      });
      view.focus();

      const startX = ev.clientX;
      const startY = ev.clientY;
      let dragStarted = false;
      const DRAG_THRESHOLD_PX = 3;

      // 클릭과 드래그를 분리: 임계값 이상 움직일 때만 선택 확장.
      const onMove = (moveEv: MouseEvent) => {
        if ((moveEv.buttons & 1) === 0) return;
        const dx = Math.abs(moveEv.clientX - startX);
        const dy = Math.abs(moveEv.clientY - startY);
        if (!dragStarted) {
          if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return;
          dragStarted = true;
        }
        const head = resolveDocPos(moveEv.clientX, moveEv.clientY, anchor);
        view.dispatch({
          selection: { anchor, head },
          scrollIntoView: true,
        });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    return el;
  }
}

function buildHybridDecorations(state: EditorView["state"]): DecorationSet {
  const activeLineNo = state.doc.lineAt(state.selection.main.head).number;
  const selMain = state.selection.main;
  const selFrom = Math.min(selMain.from, selMain.to);
  const selTo = Math.max(selMain.from, selMain.to);
  const hasRangeSelection = selFrom !== selTo;
  const lineDecos: Range<Decoration>[] = [];
  const markDecos: Range<Decoration>[] = [];
  const blockDecos: Range<Decoration>[] = [];
  for (let i = 1; i <= state.doc.lines; i += 1) {
    const line = state.doc.line(i);
    if (i === activeLineNo) {
      const headingCls = headingLevelClass(line.text);
      if (headingCls) {
        lineDecos.push(Decoration.line({ class: headingCls }).range(line.from));
      }
      if (hasRangeSelection) {
        const overlapFrom = Math.max(line.from, selFrom);
        const overlapTo = Math.min(line.to, selTo);
        if (overlapTo > overlapFrom) {
          markDecos.push(
            Decoration.mark({ class: "memo-selection" }).range(overlapFrom, overlapTo),
          );
        }
      }
      continue;
    }
    let highlightFrom = 0;
    let highlightTo = 0;
    if (hasRangeSelection) {
      const overlapFrom = Math.max(line.from, selFrom);
      const overlapTo = Math.min(line.to, selTo);
      if (overlapTo > overlapFrom) {
        highlightFrom = overlapFrom - line.from;
        highlightTo = overlapTo - line.from;
      }
    }
    blockDecos.push(
      Decoration.replace({
        block: true,
        widget: new RenderedMarkdownLineWidget(line.text, line.from, highlightFrom, highlightTo),
      }).range(line.from, line.to),
    );
  }
  return Decoration.set([...lineDecos, ...markDecos, ...blockDecos], true);
}

export const hybridMarkdownField = StateField.define<DecorationSet>({
  create(state) {
    return buildHybridDecorations(state);
  },
  update(deco, tr) {
    if (tr.docChanged || tr.selection) return buildHybridDecorations(tr.state);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// 우측 여백 더블클릭 → 줄 전체 선택. 위젯/cm-line 양쪽에서 모두 잡히도록
// 타이밍 기반 더블클릭 추적을 한다.
let __lastEditorMouseDown: { line: number; time: number; margin: boolean } | null = null;
export const editorMouseHandlers = EditorView.domEventHandlers({
  mousedown(ev, view) {
    if (ev.button !== 0) return false;
    const target = ev.target as HTMLElement;
    let lineNumber = -1;
    let isAtRightMargin = false;
    const widgetEl = target.closest("[data-cm-widget-line]") as HTMLElement | null;
    if (widgetEl) {
      const n = parseInt(widgetEl.dataset.cmWidgetLine ?? "-1", 10);
      if (Number.isFinite(n) && n >= 1) {
        lineNumber = n;
        const textSpan = widgetEl.querySelector("span") as HTMLElement | null;
        const ref = textSpan ?? widgetEl;
        const r = ref.getBoundingClientRect();
        isAtRightMargin = ev.clientX >= r.right + 1;
      }
    } else {
      const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY }, false);
      if (typeof pos === "number") {
        const ln = view.state.doc.lineAt(pos);
        lineNumber = ln.number;
        isAtRightMargin = pos === ln.to;
      }
    }
    if (lineNumber < 1) return false;
    const now = Date.now();
    const prev = __lastEditorMouseDown;
    __lastEditorMouseDown = { line: lineNumber, time: now, margin: isAtRightMargin };
    if (
      prev &&
      prev.margin &&
      isAtRightMargin &&
      prev.line === lineNumber &&
      now - prev.time < 500
    ) {
      ev.preventDefault();
      const ln = view.state.doc.line(lineNumber);
      view.dispatch({
        selection: { anchor: ln.from, head: ln.to },
        scrollIntoView: true,
      });
      view.focus();
      __lastEditorMouseDown = null;
      return true;
    }
    return false;
  },
});

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
});
