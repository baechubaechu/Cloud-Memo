import { Prec, StateField, type Range } from "@codemirror/state";
import { redo, undo } from "@codemirror/commands";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
  keymap,
} from "@codemirror/view";

import {
  type AttachmentImageAlign,
  getRenderedOffset,
  headingLevelClass,
  parseAttachmentLine,
  parseChecklistLine,
  parseQuoteLine,
  parseWikilinks,
  renderMarkdownLineHtml,
  serializeAttachmentMarker,
} from "./markdown";

// 첨부 마커를 인증된 미디어로 hydrate 하기 위한 모듈 전역 상태.
// Workbench 가 마운트/토큰 변화 시점에 setEditorAuthContext 로 주입한다.
type EditorAuthContext = { token: string; apiUrl: string };
let __authCtx: EditorAuthContext | null = null;

export function setEditorAuthContext(ctx: EditorAuthContext | null): void {
  __authCtx = ctx;
}

// 미디어 paste / drop 핸들러가 호출할 "현재 활성 노트에 파일을 업로드해서 마커를
// 본문에 삽입" 콜백. Workbench 가 마운트/리렌더 시점에 setEditorInsertFile 로
// 최신 클로저를 주입한다. 모듈 전역으로 둬서 CodeMirror 확장이 React 의 리렌더
// 사이클과 무관하게 항상 같은 함수 핸들을 통해 최신 동작을 호출할 수 있게 한다.
type InsertFileFn = (file: File) => void;
let __insertFile: InsertFileFn | null = null;
export function setEditorInsertFile(fn: InsertFileFn | null): void {
  __insertFile = fn;
}

// `[[노트 제목]]` 위키링크가 렌더된 결과 (`<a data-link="제목">`) 를 클릭했을 때
// "그 제목의 노트를 연다 / 없으면 만든다" 콜백. setEditorInsertFile 과 같은 패턴
// 으로, Workbench 가 매 렌더마다 최신 클로저를 주입한다.
type NavigateLinkFn = (title: string) => void;
let __navigateLink: NavigateLinkFn | null = null;
export function setEditorNavigateLink(fn: NavigateLinkFn | null): void {
  __navigateLink = fn;
}

// 본문에서 사용자가 마지막으로 둔 캐럿 위치. 제목 input 처럼 본문 바깥에 포커스가
// 가 있을 때도 "본문 어디에 마커를 넣어야 할지" 를 정하기 위해 따로 추적한다.
// updateListener 가 selectionSet 일 때마다 갱신한다.
let __lastDocCursor = 0;
// 사용자가 본문에서 명시적으로 캐럿을 둔 적이 있는지. 단순히 노트가 로드될 때
// CodeMirror 가 selection 을 0 으로 초기화하는 것은 "사용자가 0 에 두기로 한 것"
// 이 아니므로 이 플래그를 false 로 유지해야 한다. mouseup / keyup / paste / drop /
// focus 같은 사용자 직접 행위가 있을 때만 true 로 올린다. 노트 전환 시점에는
// resetLastDocCursor 로 다시 false.
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
function syncCursorFromView(view: EditorView, markExplicit: boolean): void {
  __lastDocCursor = Math.min(
    view.state.selection.main.from,
    view.state.doc.length,
  );
  if (markExplicit) __cursorEverExplicit = true;
}
export const editorCursorTracker = EditorView.updateListener.of((u) => {
  if (u.selectionSet || u.docChanged || u.focusChanged) {
    __lastDocCursor = Math.min(u.state.selection.main.from, u.state.doc.length);
  }
});
// 일부 브라우저에서 widget 안 mousedown 등 특수 케이스에서 selectionSet 이 한
// 박자 늦게 잡히는 경우가 있어, 보강용으로 mouseup / keyup 시점에도 한 번 더
// 강제로 동기화한다. 이 경로의 이벤트는 모두 사용자가 직접 일으킨 것이므로
// __cursorEverExplicit 도 같이 올린다.
export const editorCursorBackupSync = EditorView.domEventHandlers({
  mouseup(_ev, view) {
    syncCursorFromView(view, true);
    return false;
  },
  keyup(_ev, view) {
    syncCursorFromView(view, true);
    return false;
  },
  focus(_ev, view) {
    syncCursorFromView(view, true);
    return false;
  },
});

const __blobCache = new Map<string, string>();
function getBlobUrlFor(kind: "image" | "audio" | "file", attId: string): Promise<string | null> {
  const key = `${kind}:${attId}`;
  const cached = __blobCache.get(key);
  if (cached) return Promise.resolve(cached);
  const ctx = __authCtx;
  if (!ctx) return Promise.resolve(null);
  const url =
    kind === "image"
      ? `${ctx.apiUrl}/api/attachments/${attId}/thumbnail`
      : `${ctx.apiUrl}/api/attachments/${attId}/download`;
  return fetch(url, { headers: { Authorization: `Bearer ${ctx.token}` } })
    .then(async (resp) => {
      if (!resp.ok) return null;
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      __blobCache.set(key, objUrl);
      return objUrl;
    })
    .catch(() => null);
}

// 이미지 블록의 "선택" 상태(=툴바/리사이즈 핸들 노출 여부)를 attachment id 기준
// 으로 한 군데에서 추적한다. 마커 갱신으로 위젯 DOM 이 다시 만들어져도 같은
// 첨부면 선택 상태가 그대로 유지되고, 본문 다른 곳을 클릭하면 자동 해제된다.
let __selectedAttachmentId: string | null = null;
let __imageBlockGlobalsInstalled = false;
function installImageBlockGlobals(): void {
  if (__imageBlockGlobalsInstalled || typeof document === "undefined") return;
  __imageBlockGlobalsInstalled = true;
  document.addEventListener(
    "mousedown",
    (ev) => {
      const t = ev.target as HTMLElement | null;
      if (!t) return;
      if (t.closest(".memo-image-block")) return;
      if (__selectedAttachmentId === null) return;
      __selectedAttachmentId = null;
      document
        .querySelectorAll(".memo-image-block.is-selected")
        .forEach((el) => el.classList.remove("is-selected"));
    },
    true,
  );
}
function setSelectedAttachment(id: string, target: HTMLElement): void {
  __selectedAttachmentId = id;
  if (typeof document !== "undefined") {
    document
      .querySelectorAll(".memo-image-block.is-selected")
      .forEach((el) => {
        if (el !== target) el.classList.remove("is-selected");
      });
  }
  target.classList.add("is-selected");
}

function updateImageMarkerLine(
  view: EditorView,
  rawLine: string,
  lineFrom: number,
  patch: { width?: number; align?: AttachmentImageAlign },
): void {
  const marker = parseAttachmentLine(rawLine);
  if (!marker || marker.kind !== "image") return;
  const next = serializeAttachmentMarker({
    ...marker,
    ...(patch.width ? { width: Math.min(1200, Math.max(80, Math.round(patch.width))) } : {}),
    ...(patch.align ? { align: patch.align } : {}),
  });
  const currentLine = view.state.doc.lineAt(lineFrom);
  view.dispatch({
    changes: { from: currentLine.from, to: currentLine.to, insert: next },
    selection: { anchor: currentLine.from + next.length },
    scrollIntoView: true,
  });
}

/** 위젯 HTML 안의 .memo-attachment placeholder 들을 실제 미디어로 교체. */
function hydrateAttachmentsIn(
  root: HTMLElement,
  view: EditorView,
  rawLine: string,
  lineFrom: number,
): void {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(".memo-attachment"));
  for (const node of nodes) {
    const id = node.getAttribute("data-att-id") || "";
    const kind = (node.getAttribute("data-att-kind") || "file") as "image" | "audio" | "file";
    const label = node.getAttribute("data-att-label") || "";
    if (!id) continue;
    if (kind === "image") {
      installImageBlockGlobals();
      const width = Number(node.getAttribute("data-att-width") || "") || 360;
      const align = (node.getAttribute("data-att-align") || "left") as AttachmentImageAlign;
      const outer = document.createElement("span");
      outer.className = "memo-image-block relative my-2 inline-block max-w-full align-top";
      outer.style.width = `${Math.min(1200, Math.max(80, width))}px`;
      outer.style.maxWidth = "100%";
      outer.style.display = "block";
      if (align === "center") {
        outer.style.marginLeft = "auto";
        outer.style.marginRight = "auto";
      } else if (align === "right") {
        outer.style.marginLeft = "auto";
        outer.style.marginRight = "0";
      } else {
        outer.style.marginLeft = "0";
        outer.style.marginRight = "auto";
      }
      // 위젯이 다시 만들어져도(예: 리사이즈로 마커가 갱신되면 widget eq() 가
      // false 여서 새로 그림) 같은 첨부면 선택 상태를 복원한다.
      if (__selectedAttachmentId === id) outer.classList.add("is-selected");

      const img = document.createElement("img");
      img.alt = label;
      img.className = "memo-attachment-img max-h-[70vh] w-full max-w-full rounded-lg border border-ink-900/10 object-contain";
      img.style.display = "block";
      img.style.userSelect = "none";
      img.draggable = false;
      img.style.cursor = "pointer";
      // 이미지 자체 클릭 → 그 첨부를 선택 상태로 바꿔 툴바/핸들 노출.
      // mousedown 은 위젯의 mousedown(다음 줄로 캐럿 이동) 이 그대로 돌게 둔다.
      img.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        setSelectedAttachment(id, outer);
      });

      const toolbar = document.createElement("span");
      toolbar.className = "memo-image-toolbar absolute left-2 top-2 z-10 gap-1 rounded-md bg-white/90 p-1 text-[11px] shadow-sm ring-1 ring-ink-900/10";
      const makeButton = (text: string, title: string, onClick: () => void) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.title = title;
        button.className = "rounded px-1.5 py-0.5 text-ink-900/70 hover:bg-ink-900/10";
        button.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        });
        button.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          onClick();
        });
        return button;
      };
      toolbar.append(
        makeButton("L", "왼쪽 정렬", () => updateImageMarkerLine(view, rawLine, lineFrom, { align: "left" })),
        makeButton("C", "가운데 정렬", () => updateImageMarkerLine(view, rawLine, lineFrom, { align: "center" })),
        makeButton("R", "오른쪽 정렬", () => updateImageMarkerLine(view, rawLine, lineFrom, { align: "right" })),
      );

      // 우상단 별도 삭제 버튼. 본문에서 이 이미지 마커 줄을 통째로 제거한다.
      // 첨부 파일 자체는 서버에 그대로 남고, 마커만 본문에서 빠진다.
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.title = "이미지 제거";
      removeBtn.setAttribute("aria-label", "이미지 제거");
      removeBtn.className =
        "memo-image-remove absolute right-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-md bg-white/90 text-[11px] text-ink-900/70 shadow-sm ring-1 ring-ink-900/10 hover:bg-red-50 hover:text-red-700";
      removeBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      removeBtn.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      });
      removeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const currentLine = view.state.doc.lineAt(lineFrom);
        removeWholeAttachmentLine(view, currentLine);
        // 위젯 DOM 이 같은 click 흐름 안에서 제거되므로, focus() 를 즉시
        // 호출하면 contentDOM 이 아닌 곳으로 포커스가 빠질 수 있다. 다음
        // 프레임에서 focus 해야 그 직후 Ctrl+Z 가 에디터에 도달한다.
        requestAnimationFrame(() => view.focus());
      });

      const handle = document.createElement("span");
      handle.className = "memo-image-resize-handle absolute bottom-1 right-1 h-4 w-4 cursor-nwse-resize rounded-sm bg-white/90 shadow-sm ring-1 ring-ink-900/15";
      handle.style.touchAction = "none";
      handle.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const startX = ev.clientX;
        const startWidth = outer.getBoundingClientRect().width;
        let latestWidth = startWidth;
        const onMove = (moveEv: MouseEvent) => {
          latestWidth = Math.min(1200, Math.max(80, startWidth + moveEv.clientX - startX));
          outer.style.width = `${latestWidth}px`;
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          updateImageMarkerLine(view, rawLine, lineFrom, { width: latestWidth });
          view.focus();
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });

      // placeholder 유지하면서 비동기 로드
      void getBlobUrlFor("image", id).then((u) => {
        if (u) img.src = u;
      });
      outer.append(img, toolbar, removeBtn, handle);
      node.replaceChildren(outer);
    } else if (kind === "audio") {
      const wrap = document.createElement("span");
      wrap.className = "memo-attachment-audio-wrap inline-flex items-center gap-2 rounded-md bg-ink-900/5 px-2 py-1 text-[12px] text-ink-900/70";
      const icon = document.createElement("span");
      icon.textContent = "\u{1F3A4}";
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "none";
      audio.className = "memo-attachment-audio-el";
      audio.style.maxWidth = "260px";
      audio.style.verticalAlign = "middle";
      const cap = document.createElement("span");
      cap.textContent = label || "음성";
      void getBlobUrlFor("audio", id).then((u) => {
        if (u) audio.src = u;
      });
      wrap.append(icon, audio, cap);
      node.replaceChildren(wrap);
    } else {
      const a = document.createElement("a");
      a.href = "#";
      a.className = "memo-attachment-file-link text-sky-700 underline underline-offset-2";
      a.textContent = `\u{1F4CE} ${label || "첨부 파일"}`;
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void getBlobUrlFor("file", id).then((u) => {
          if (!u) return;
          const w = window.open(u, "_blank", "noopener,noreferrer");
          if (!w) window.location.assign(u);
        });
      });
      node.replaceChildren(a);
    }
  }
}

// 비활성(렌더 모드) 줄 안의 `[[노트 제목]]` 위키링크 (`<a data-link="제목">`) 에
// 클릭 핸들러를 붙인다. 위젯 root 의 mousedown 핸들러는 캐럿을 본문 안으로
// 옮기기 때문에, 링크 자체에서는 mousedown / click 모두 stopPropagation 해서
// "캐럿 이동 + 노트 이동" 이 동시에 일어나는 사고를 막는다.
function hydrateWikilinksIn(root: HTMLElement): void {
  const links = Array.from(root.querySelectorAll<HTMLElement>("a[data-link]"));
  for (const link of links) {
    const title = (link.getAttribute("data-link") || "").trim();
    if (!title) continue;
    link.style.cursor = "pointer";
    link.classList.add("memo-wikilink");
    link.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    link.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const fn = __navigateLink;
      if (fn) fn(title);
    });
  }
}

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

// 활성(편집 중) 체크리스트 줄에서 `- [ ] ` / `- [x] ` 부분을 가리고 그 자리에
// 클릭 가능한 체크박스를 보여주는 인라인 위젯. 본문 텍스트는 위젯 뒤에 그대로
// 노출되어 편집 가능하다. 비활성 줄은 RenderedMarkdownLineWidget 이 줄 전체를
// 그리므로 그쪽에서 같이 처리된다.
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

// 활성(편집 중) 인용 줄에서 `> ` prefix 를 가린다. 인용임을 나타내는 시각
// 요소는 .memo-quote-line 의 좌측 라인이 담당하므로, 원문 `>` 는 보일 필요가 없다.
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

// 활성 줄에서도 Space 로 확정된 `[[노트 제목]]` 은 raw 마크다운 대신 링크처럼
// 보이게 한다. 단, 커서가 링크 안에 있을 때는 편집 가능해야 하므로 이 위젯은
// buildHybridDecorations 쪽에서 "커서가 범위 밖이고 뒤에 공백이 있는 링크" 에만
// 붙인다.
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
      __navigateLink?.(this.title);
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
    // 첨부 placeholder 가 있으면 토큰을 사용해 인증된 미디어로 교체.
    hydrateAttachmentsIn(text, view, this.rawLine, this.lineFrom);
    // `[[노트 제목]]` 위키링크에 클릭 → 노트 이동 핸들러를 붙인다.
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
        // 캐럿을 괄호 안(`[x|]`) 에 두면 그 자리에서 Enter 가 눌릴 때 줄이
        // 괄호 사이에서 잘려 깨진다. 줄 끝으로 옮겨서 일반 편집과 똑같이
        // 동작하게 한다.
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
      // 첨부 줄(이미지/오디오/파일)을 클릭했을 때:
      // - 캐럿을 그 줄에 두면 위젯 높이만큼 캐럿이 거대해져 글자처럼 보이는
      //   문제가 생긴다.
      // - 그래서 다음 줄 시작점으로 캐럿을 옮겨서 일반 텍스트 줄에 캐럿이
      //   놓이게 한다. 다음 줄이 없으면 새 줄을 만들어서라도 그 자리에 둔다.
      if (isAttachment) {
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
          // 다음 줄이 이미 있으면 그 시작점으로.
          view.dispatch({
            selection: { anchor: lineTo + 1 },
            scrollIntoView: true,
          });
        } else {
          // 마지막 줄이라 다음 줄이 없다면 줄바꿈을 만들고 거기로 보낸다.
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
    // 첨부 줄(이미지/오디오/파일)은 활성 줄이어도 raw 마크다운으로 돌아가지
    // 않게 항상 위젯으로 렌더한다.
    const isAttachment = parseAttachmentLine(line.text) !== null;
    if (i === activeLineNo && !isAttachment) {
      // 체크리스트 줄은 활성 상태에서도 마크다운 prefix(`- [ ] ` / `- [x] `) 가
      // raw 로 풀리지 않도록, 그 부분만 인라인 체크박스 위젯으로 가리고 본문은
      // 그대로 편집 가능하게 둔다. 노션처럼 체크박스가 살아있는 토글로 동작.
      const activeChecklist = parseChecklistLine(line.text);
      if (activeChecklist) {
        const prefixEnd = line.from + activeChecklist.textOffset;
        markDecos.push(
          Decoration.replace({
            widget: new ChecklistPrefixWidget(
              activeChecklist.checked,
              line.from + activeChecklist.stateOffset,
            ),
          }).range(line.from, prefixEnd),
        );
        if (activeChecklist.checked && line.to > prefixEnd) {
          markDecos.push(
            Decoration.mark({ class: "memo-checklist-text-checked" }).range(prefixEnd, line.to),
          );
        }
        if (hasRangeSelection) {
          const overlapFrom = Math.max(prefixEnd, selFrom);
          const overlapTo = Math.min(line.to, selTo);
          if (overlapTo > overlapFrom) {
            markDecos.push(
              Decoration.mark({ class: "memo-selection" }).range(overlapFrom, overlapTo),
            );
          }
        }
        continue;
      }
      const headingCls = headingLevelClass(line.text);
      if (headingCls) {
        lineDecos.push(Decoration.line({ class: headingCls }).range(line.from));
      }
      // 인용 줄 (`> ...`) 은 액티브 상태에서도 인용 스타일 (좌측 라인 + 흐린 글씨)
      // 을 유지하되, `> ` prefix 는 체크박스 prefix 처럼 숨긴다.
      const activeQuote = parseQuoteLine(line.text);
      if (activeQuote) {
        lineDecos.push(Decoration.line({ class: "memo-quote-line" }).range(line.from));
        const prefixEnd = line.from + activeQuote.prefixLen;
        markDecos.push(
          Decoration.replace({ widget: new QuotePrefixWidget() }).range(line.from, prefixEnd),
        );
      }
      // Space 로 확정된 위키링크는 활성 줄 안에서도 링크처럼 보인다.
      // 확정 기준은 `[[title]] ` 처럼 닫는 괄호 바로 뒤에 공백이 생긴 상태.
      // 커서/선택이 링크 내부에 닿아 있으면 raw 문법을 보여줘서 편집 가능하게 둔다.
      for (const link of parseWikilinks(line.text)) {
        const nextChar = line.text[link.to] ?? "";
        if (nextChar && !/\s/.test(nextChar)) continue;
        const linkFrom = line.from + link.from;
        const linkTo = line.from + link.to;
        const cursorInside = selMain.empty && selMain.head >= linkFrom && selMain.head <= linkTo;
        const selectionOverlaps = hasRangeSelection && selTo > linkFrom && selFrom < linkTo;
        if (cursorInside || selectionOverlaps) continue;
        markDecos.push(
          Decoration.replace({ widget: new WikilinkInlineWidget(link.title) }).range(linkFrom, linkTo),
        );
      }
      if (hasRangeSelection) {
        const activeQuotePrefixEnd = activeQuote ? line.from + activeQuote.prefixLen : line.from;
        const overlapFrom = Math.max(activeQuotePrefixEnd, selFrom);
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

// ---------- 미디어 paste / drop / dragover 핸들러 ----------
// React useEffect 로 view.dom 에 직접 listener 를 다는 방식은 CodeMirror 내부의
// paste/drop 기본 동작이 먼저 실행되면서 이벤트가 살아있어도 텍스트로만 처리되어
// 파일이 무시되는 일이 잦다. 그래서 EditorView.domEventHandlers 로 확장에 묶어
// 두면 CodeMirror 의 default 보다 먼저 실행되고, true 를 반환해 default 를 막을
// 수 있다.
function collectFilesFromTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.items && dt.items.length > 0) {
    for (let i = 0; i < dt.items.length; i += 1) {
      const it = dt.items[i];
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  if (out.length === 0 && dt.files && dt.files.length > 0) {
    for (let i = 0; i < dt.files.length; i += 1) out.push(dt.files[i]);
  }
  return out;
}

export const editorMediaInputHandlers = EditorView.domEventHandlers({
  paste(ev, view) {
    const files = collectFilesFromTransfer(ev.clipboardData);
    if (files.length === 0) return false; // 텍스트만 있으면 CodeMirror 기본 처리.
    ev.preventDefault();
    ev.stopPropagation();
    // paste 는 본문 포커스 상태에서만 일어난다 → 현재 selection 을 신뢰한다.
    syncCursorFromView(view, true);
    const fn = __insertFile;
    if (!fn) return true;
    for (const f of files) fn(f);
    return true;
  },
  dragover(ev) {
    if (ev.dataTransfer && Array.from(ev.dataTransfer.types).includes("Files")) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      return true;
    }
    return false;
  },
  drop(ev, view) {
    const files = collectFilesFromTransfer(ev.dataTransfer);
    if (files.length === 0) return false;
    ev.preventDefault();
    ev.stopPropagation();
    // 사용자 요청: "본문 구역 어디에나 드랍해도 현재 커서 깜빡거리는 위치에"
    // → 드롭 좌표는 무시하고 본문 currentcursor 자리에 삽입한다. 다만 사용자가
    //   본문에 한 번도 클릭한 적이 없으면 캐럿이 0 인데 그건 사용자 의도가 아니라
    //   초기값이다. 그런 경우는 드롭 좌표를 캐럿으로 잡아서 자연스럽게 한다.
    if (!__cursorEverExplicit) {
      const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY });
      if (typeof pos === "number") {
        view.dispatch({ selection: { anchor: pos } });
        syncCursorFromView(view, true);
      } else {
        // 좌표 매핑 실패 시 문서 끝.
        const end = view.state.doc.length;
        view.dispatch({ selection: { anchor: end } });
        syncCursorFromView(view, true);
      }
    }
    const fn = __insertFile;
    if (!fn) return true;
    for (const f of files) fn(f);
    return true;
  },
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
    if (lineNumber < 1) {
      // 본문 안 어디에도 cm-line / widget 매핑이 안 되는 위치(=cm-content 의
      // 빈 아래쪽 여백)에 클릭한 경우. 본문 마지막 줄 끝으로 캐럿을 옮긴다.
      // - 위젯 블록 데코레이션 때문에 CodeMirror 기본 mousedown 이 빈 여백을
      //   본문 끝으로 매핑하지 못하는 케이스가 있다.
      const contentEl = view.contentDOM;
      const cRect = contentEl.getBoundingClientRect();
      const insideContent =
        ev.clientX >= cRect.left &&
        ev.clientX <= cRect.right &&
        ev.clientY >= cRect.top &&
        ev.clientY <= cRect.bottom + 200;
      const lastLine = view.state.doc.line(view.state.doc.lines);
      const lastCoords = view.coordsAtPos(lastLine.to);
      const belowText = lastCoords ? ev.clientY > lastCoords.bottom : insideContent;
      if (insideContent && belowText) {
        ev.preventDefault();
        view.dispatch({
          selection: { anchor: view.state.doc.length },
          scrollIntoView: true,
        });
        view.focus();
        return true;
      }
      return false;
    }
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

// ---------- 위/아래 화살표 + 첨부 줄 삭제 키맵 ----------
//
// 1) ArrowUp / ArrowDown
//    비활성 줄을 block widget(Decoration.replace block:true) 으로 통째로 대체
//    하기 때문에, CodeMirror 기본 cursorUp/Down (시각 좌표 기반) 이 위젯 경계
//    를 못 넘어 doc 의 맨 처음/끝으로 점프하는 현상이 있다. doc-line 단위로
//    한 줄씩 이동하고 컬럼은 가능한 한 보존한다.
//
// 2) Backspace / Delete
//    "이미지는 업로드 한 순간부터 그냥 이미지". 첨부 줄에서 한 글자만 지우면
//    `![...](attachment://abc)` 패턴이 깨져 raw 마크다운으로 다시 보이는 게
//    사용자 직관에 어긋나므로, 첨부 줄에 닿는 삭제는 아예 그 줄 통째로 한 번에
//    제거한다.

function isAttachmentLineText(text: string): boolean {
  return parseAttachmentLine(text) !== null;
}

function removeWholeAttachmentLine(
  view: EditorView,
  line: { from: number; to: number },
): boolean {
  const docLen = view.state.doc.length;
  let from: number;
  let to: number;
  if (line.from > 0) {
    // 앞에 \n 이 있으면 앞 \n 까지 같이 지운다 (앞 줄 끝에 캐럿이 남게).
    from = line.from - 1;
    to = line.to;
  } else if (line.to < docLen) {
    // 첫 줄이라 앞에 \n 이 없을 땐 뒤 \n 까지 지운다.
    from = 0;
    to = line.to + 1;
  } else {
    // 첫 줄이자 마지막 줄(=문서 전체).
    from = 0;
    to = docLen;
  }
  view.dispatch({
    changes: { from, to, insert: "" },
    selection: { anchor: from },
    scrollIntoView: true,
    // Ctrl+Z 그룹핑 안정화. 명시적 user event 가 있으면 history 가 이 변경을
    // 한 단위로 깔끔하게 묶어서 되돌리기/다시실행이 한 번에 끝난다.
    userEvent: "delete.attachment",
  });
  return true;
}

export const editorNavAndDeleteKeymap = Prec.high(
  keymap.of([
    {
      key: "ArrowUp",
      run(view) {
        const { state } = view;
        const sel = state.selection.main;
        if (!sel.empty) return false;
        const line = state.doc.lineAt(sel.head);
        if (line.number <= 1) {
          // 이미 첫 줄: 줄 시작으로만 보낸다 (default 면 doc 맨 위로 갈 수 있어).
          if (sel.head !== line.from) {
            view.dispatch({
              selection: { anchor: line.from },
              scrollIntoView: true,
            });
            return true;
          }
          return true; // 더 위로 안 감 (jump 방지).
        }
        const prev = state.doc.line(line.number - 1);
        const col = sel.head - line.from;
        const target = Math.min(prev.from + col, prev.to);
        view.dispatch({
          selection: { anchor: target },
          scrollIntoView: true,
        });
        return true;
      },
    },
    {
      key: "ArrowDown",
      run(view) {
        const { state } = view;
        const sel = state.selection.main;
        if (!sel.empty) return false;
        const line = state.doc.lineAt(sel.head);
        if (line.number >= state.doc.lines) {
          if (sel.head !== line.to) {
            view.dispatch({
              selection: { anchor: line.to },
              scrollIntoView: true,
            });
            return true;
          }
          return true;
        }
        const next = state.doc.line(line.number + 1);
        const col = sel.head - line.from;
        const target = Math.min(next.from + col, next.to);
        view.dispatch({
          selection: { anchor: target },
          scrollIntoView: true,
        });
        return true;
      },
    },
    {
      key: "Backspace",
      run(view) {
        const { state } = view;
        const sel = state.selection.main;
        if (!sel.empty) return false;
        const line = state.doc.lineAt(sel.head);
        if (isAttachmentLineText(line.text)) {
          return removeWholeAttachmentLine(view, line);
        }
        if (sel.head === line.from && line.number > 1) {
          const prev = state.doc.line(line.number - 1);
          if (isAttachmentLineText(prev.text)) {
            return removeWholeAttachmentLine(view, prev);
          }
        }
        // 체크박스 prefix(`- [ ] ` / `- [x] `) 는 한 단위로 삭제. 텍스트 시작점
        // (또는 그 이전 어디에서든 hidden range 안) 에서 Backspace 를 누르면
        // prefix 전체가 통째로 사라지고 일반 텍스트 줄로 돌아간다.
        const checklist = parseChecklistLine(line.text);
        if (checklist) {
          const prefixEnd = line.from + checklist.textOffset;
          if (sel.head > line.from && sel.head <= prefixEnd) {
            view.dispatch({
              changes: { from: line.from, to: prefixEnd, insert: "" },
              selection: { anchor: line.from },
              userEvent: "delete.checklist.prefix",
            });
            return true;
          }
        }
        // 인용 prefix(`> `) 도 화면에서는 숨겨져 있으므로, 첫 글자 앞에서
        // Backspace 를 누르면 prefix 전체를 지워 일반 문단으로 돌린다.
        const quote = parseQuoteLine(line.text);
        if (quote) {
          const prefixEnd = line.from + quote.prefixLen;
          if (sel.head > line.from && sel.head <= prefixEnd) {
            view.dispatch({
              changes: { from: line.from, to: prefixEnd, insert: "" },
              selection: { anchor: line.from },
              userEvent: "delete.quote.prefix",
            });
            return true;
          }
        }
        return false;
      },
    },
    {
      key: "Delete",
      run(view) {
        const { state } = view;
        const sel = state.selection.main;
        if (!sel.empty) return false;
        const line = state.doc.lineAt(sel.head);
        if (isAttachmentLineText(line.text)) {
          return removeWholeAttachmentLine(view, line);
        }
        if (sel.head === line.to && line.number < state.doc.lines) {
          const next = state.doc.line(line.number + 1);
          if (isAttachmentLineText(next.text)) {
            return removeWholeAttachmentLine(view, next);
          }
        }
        const quote = parseQuoteLine(line.text);
        if (quote && sel.head === line.from) {
          const prefixEnd = line.from + quote.prefixLen;
          view.dispatch({
            changes: { from: line.from, to: prefixEnd, insert: "" },
            selection: { anchor: line.from },
            userEvent: "delete.quote.prefix",
          });
          return true;
        }
        return false;
      },
    },
    {
      // 체크리스트 줄에서 Enter:
      //   - 텍스트가 있는 항목 (- [ ] foo) → 다음 줄에 빈 unchecked 항목 추가.
      //   - 텍스트가 빈 항목 (- [ ]  또는 - [x]  ) → 마커를 지우고 빈 줄로.
      // markdown() 확장의 자동 처리가 우리 의도와 어긋나는(특히 체크박스를
      // 클릭한 직후 캐럿이 어색한 위치에 있을 때 줄을 통째로 깨먹는) 케이스를
      // 막기 위해 우리가 먼저 잡는다.
      key: "Enter",
      run(view) {
        const { state } = view;
        const sel = state.selection.main;
        if (!sel.empty) return false;
        const line = state.doc.lineAt(sel.head);

        // 인용 줄에서 Enter:
        //   - 본문이 빈 인용 (`> ` 만 있음) → prefix 지우고 빈 줄로.
        //   - 본문이 있는 인용 → 다음 줄에 일반 문단 (인용 prefix 안 이어줌).
        const quote = parseQuoteLine(line.text);
        if (quote) {
          if (!quote.text.trim()) {
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: "" },
              selection: { anchor: line.from },
              scrollIntoView: true,
              userEvent: "input.quote",
            });
            return true;
          }
          view.dispatch({
            changes: { from: sel.head, to: sel.head, insert: "\n" },
            selection: { anchor: sel.head + 1 },
            scrollIntoView: true,
            userEvent: "input.quote",
          });
          return true;
        }

        const checklist = parseChecklistLine(line.text);
        if (!checklist) return false;
        if (!checklist.text.trim()) {
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: "" },
            selection: { anchor: line.from },
            scrollIntoView: true,
            userEvent: "input.checklist",
          });
          return true;
        }
        const indent = (line.text.match(/^\s*/) ?? [""])[0];
        const insert = `\n${indent}- [ ] `;
        view.dispatch({
          changes: { from: sel.head, to: sel.head, insert },
          selection: { anchor: sel.head + insert.length },
          scrollIntoView: true,
          userEvent: "input.checklist",
        });
        return true;
      },
    },
  ]),
);

// markdown 확장의 기본 blockquote 이어쓰기보다 반드시 먼저 실행되어야 한다.
// 일반적인 markdown 에디터는 `> foo` 에서 Enter 시 다음 줄도 `> ` 로 이어주지만,
// 이 앱에서는 인용을 한 줄 단위로 보고 Enter 이후는 일반 문단으로 돌아간다.
export const editorQuoteEnterKeymap = Prec.highest(
  keymap.of([
    {
      key: "Enter",
      run(view) {
        const { state } = view;
        const sel = state.selection.main;
        if (!sel.empty) return false;
        const line = state.doc.lineAt(sel.head);
        const quote = parseQuoteLine(line.text);
        if (!quote) return false;

        if (!quote.text.trim()) {
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: "" },
            selection: { anchor: line.from },
            scrollIntoView: true,
            userEvent: "input.quote",
          });
          return true;
        }

        view.dispatch({
          changes: { from: sel.head, to: sel.head, insert: "\n" },
          selection: { anchor: sel.head + 1 },
          scrollIntoView: true,
          userEvent: "input.quote",
        });
        return true;
      },
    },
  ]),
);

// 본문 편집용 undo/redo 단축키.
// 기본 keymap 에도 일부 들어있지만, 이 에디터는 block widget / high-priority
// custom keymap 이 많아서 브라우저 기본 동작으로 새지 않게 명시적으로 잡는다.
export const editorUndoRedoKeymap = Prec.highest(
  keymap.of([
    { key: "Mod-z", run: undo },
    { key: "Mod-y", run: redo },
    // macOS 사용자가 익숙한 redo 도 같이 지원. Windows/Linux 에서는 무해하다.
    { key: "Mod-Shift-z", run: redo },
  ]),
);

// 위키링크 확정: closeBrackets 때문에 `[[나무]]` 를 입력 중일 때 실제 커서는
// `[[나무|]]` (닫는 괄호 앞) 에 있을 수 있다. 이 상태에서 Space 를 누르면
// 위키링크를 Space 로 확정한다. 두 가지 경로를 모두 처리해야 한다.
//   1) 사용자가 직접 `[[query]]` 를 타이핑한 경우 (closeBrackets 가 `]]` 를 자동
//      입력해 커서가 `[[query|]]` 위치에 있다). → `]]` 뒤에 공백을 추가한다.
//   2) replaceWikilink 가 메뉴 선택 결과를 doc 에 박은 경우. 닫는 괄호를 일부러
//      먹어버려서 doc 이 `[[Title|` 상태가 된다. → `]] ` 를 통째로 삽입한다.
// 두 경로 모두 결과는 `[[Title]] ` 이므로 buildHybridDecorations 와
// renderInlineMarkdown 이 동일하게 위젯/링크로 렌더링한다.
export const editorWikilinkConfirmKeymap = Prec.high(
  keymap.of([
    {
      key: "Space",
      run(view) {
        const { state } = view;
        const sel = state.selection.main;
        if (!sel.empty) return false;
        const line = state.doc.lineAt(sel.head);
        const offset = sel.head - line.from;
        const beforeCursor = line.text.slice(0, offset);
        const afterCursor = line.text.slice(offset);
        if (!/\[\[([^\[\]\n]+)$/.test(beforeCursor)) return false;

        if (afterCursor.startsWith("]]")) {
          const insertAt = sel.head + 2;
          view.dispatch({
            changes: { from: insertAt, to: insertAt, insert: " " },
            selection: { anchor: insertAt + 1 },
            scrollIntoView: true,
            userEvent: "input.wikilink.confirm",
          });
          return true;
        }

        if (!afterCursor.startsWith("]")) {
          // 닫는 괄호가 아예 없는 상태 (replaceWikilink 가 먹어버림). `]] ` 를 통째로
          // 삽입해 확정한다.
          view.dispatch({
            changes: { from: sel.head, to: sel.head, insert: "]] " },
            selection: { anchor: sel.head + 3 },
            scrollIntoView: true,
            userEvent: "input.wikilink.confirm",
          });
          return true;
        }

        return false;
      },
    },
  ]),
);

// 노션처럼 `[]` 뒤에서 Space 를 누르면 체크박스로 변환한다. `[` 입력 자동완성으로
// `[]` 가 만들어진 순간에는 아직 사용자의 의도가 확실하지 않으므로 건드리지 않는다.
// 입력 후 transactionFilter 로 보정하면 새 문서 좌표/기존 문서 좌표가 섞일 수 있어,
// Space 키를 입력하기 전에 현재 줄을 보고 직접 치환한다.
export const editorChecklistAutoTrigger = Prec.high(
  keymap.of([
    {
      key: "Space",
      run(view) {
        const { state } = view;
        const sel = state.selection.main;
        if (!sel.empty) return false;
        const line = state.doc.lineAt(sel.head);
        const m = line.text.match(/^(\s*)\[\]$/);
        if (!m) return false;

        const indent = m[1] ?? "";
        const cursorInEmptyBox = sel.head === line.from + indent.length + 1;
        const cursorAfterEmptyBox = sel.head === line.to;
        if (!cursorInEmptyBox && !cursorAfterEmptyBox) return false;

        const prefix = `${indent}- [ ] `;
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: prefix },
          selection: { anchor: line.from + prefix.length },
          scrollIntoView: true,
          userEvent: "input.checklist.create",
        });
        return true;
      },
    },
  ]),
);

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
  // 인용 줄: 좌측 vertical bar + 인용 본문 톤. 액티브 라인에서도 동일하게 보이도록.
  // padding-left 는 .cm-line 의 0 !important 때문에 !important 로 덮어쓴다.
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
  // 활성 체크리스트 줄에서 본문이 'checked' 상태일 때 본문에만 취소선/희미한
  // 색을 입힌다. prefix 위젯에는 닿지 않게 mark 데코레이션 한정으로 적용.
  ".memo-checklist-text-checked": {
    textDecoration: "line-through",
    color: "rgba(15, 23, 42, 0.45)",
  },
  // prefix 위젯 자체는 줄과 같은 baseline 으로 정렬되어야 텍스트와 함께 자연스럽게
  // 보인다. user-select 를 막아서 더블클릭/드래그 선택이 본문 텍스트에서 시작/끝
  // 나도록 한다.
  ".memo-checklist-prefix": {
    userSelect: "none",
  },
  // 이미지 블록 툴바/리사이즈 핸들은 기본 숨김. 이미지를 클릭하면 outer 가
  // .is-selected 가 되어 노출. 이미지 외 다른 곳을 클릭하면 자동 해제.
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
