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
    const attachmentMarker = parseAttachmentLine(this.rawLine);
    const isAttachment = attachmentMarker !== null;
    if (isAttachment) el.setAttribute("data-cm-widget-attachment", "1");
    const text = document.createElement("span");
    text.className = "inline";
    text.innerHTML = renderMarkdownLineHtml(this.rawLine);
    el.appendChild(text);
    // 첨부 placeholder 가 있으면 토큰을 사용해 인증된 미디어로 교체.
    hydrateAttachmentsIn(text, view, this.rawLine, this.lineFrom);
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
        return false;
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
