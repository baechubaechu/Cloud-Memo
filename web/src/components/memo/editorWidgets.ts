import { EditorView, WidgetType } from "@codemirror/view";
import {
  getRenderedOffset,
  parseAttachmentLine,
  parseChecklistLine,
  renderMarkdownLineHtml,
} from "./markdown";
import { hydrateAttachmentsIn, hydrateWikilinksIn } from "./editorHydrate";
import { invokeNavigateLink } from "./editorGlobals";

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

export class ChecklistPrefixWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly stateFromAbs: number,
  ) {
    super();
  }
  eq(other: ChecklistPrefixWidget): boolean {
    return this.checked === other.checked && this.stateFromAbs === other.stateFromAbs;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "memo-checklist-prefix";
    wrap.contentEditable = "false";
    wrap.setAttribute("aria-hidden", "false");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "checkbox");
    btn.setAttribute("aria-checked", this.checked ? "true" : "false");
    btn.dataset.checked = this.checked ? "true" : "false";
    btn.dataset.checklistInlineToggle = "1";
    btn.className =
      "memo-checklist-box mr-2 inline-grid h-4 w-4 shrink-0 place-items-center rounded border border-ink-900/25 bg-white align-text-top text-[11px] leading-none text-white data-[checked=true]:border-emerald-500 data-[checked=true]:bg-emerald-500";
    btn.textContent = this.checked ? "✓" : "";
    btn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const next = this.checked ? " " : "x";
      view.dispatch({
        changes: { from: this.stateFromAbs, to: this.stateFromAbs + 1, insert: next },
        userEvent: "input.checklist",
      });
      requestAnimationFrame(() => view.focus());
    });
    wrap.appendChild(btn);
    return wrap;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

export class QuotePrefixWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "memo-quote-prefix";
    span.contentEditable = "false";
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

export class WikilinkInlineWidget extends WidgetType {
  constructor(readonly title: string) {
    super();
  }
  eq(other: WikilinkInlineWidget): boolean {
    return this.title === other.title;
  }
  toDOM(): HTMLElement {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = this.title;
    a.className = "memo-wikilink text-indigo-700 underline underline-offset-2";
    a.setAttribute("data-link", this.title);
    a.contentEditable = "false";
    a.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      invokeNavigateLink(this.title);
    });
    return a;
  }
  ignoreEvent(): boolean {
    return false;
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
    const attachmentMarker = parseAttachmentLine(this.rawLine);
    const isAttachment = attachmentMarker !== null;
    if (isAttachment) el.setAttribute("data-cm-widget-attachment", "1");
    const text = document.createElement("span");
    text.className = "inline";
    text.innerHTML = renderMarkdownLineHtml(this.rawLine);
    el.appendChild(text);
    hydrateAttachmentsIn(text, view, this.rawLine, this.lineFrom);
    hydrateWikilinksIn(text);
    const checklist = parseChecklistLine(this.rawLine);
    if (checklist) {
      const toggle = text.querySelector<HTMLElement>("[data-checklist-toggle]");
      toggle?.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      });
      toggle?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const stateFrom = this.lineFrom + checklist.stateOffset;
        const next = checklist.checked ? " " : "x";
        const lineDoc = view.state.doc.lineAt(stateFrom);
        view.dispatch({
          changes: { from: stateFrom, to: stateFrom + 1, insert: next },
          selection: { anchor: lineDoc.to },
          scrollIntoView: true,
          userEvent: "input.checklist",
        });
        requestAnimationFrame(() => view.focus());
      });
    }
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
      if (isAttachment && attachmentMarker) {
        if (attachmentMarker.kind === "image") {
          const imageBlock = el.querySelector<HTMLElement>(".memo-image-block");
          const imageRect = imageBlock?.getBoundingClientRect();
          const lineRect = el.getBoundingClientRect();
          const clickedRightOfImage =
            !!imageRect &&
            ev.clientX > imageRect.right + 1 &&
            ev.clientX <= lineRect.right &&
            ev.clientY >= imageRect.top &&
            ev.clientY <= imageRect.bottom;

          if (clickedRightOfImage) {
            view.dispatch({
              selection: { anchor: lineTo },
              scrollIntoView: true,
            });
            view.focus();
            return;
          }
        }
        const docLen = view.state.doc.length;
        if (lineTo < docLen) {
          view.dispatch({
            selection: { anchor: lineTo + 1 },
            scrollIntoView: true,
          });
        } else {
          view.dispatch({
            changes: { from: docLen, to: docLen, insert: "\n" },
            selection: { anchor: docLen + 1 },
            scrollIntoView: true,
          });
        }
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
