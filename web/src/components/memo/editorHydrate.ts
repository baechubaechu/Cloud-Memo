import { EditorView } from "@codemirror/view";
import type { AttachmentImageAlign } from "./markdown";
import {
  parseAttachmentLine,
  serializeAttachmentMarker,
} from "./markdown";
import { getEditorAuthContext, invokeNavigateLink } from "./editorGlobals";
import { removeWholeAttachmentLine } from "./editorAttachmentLine";

const __blobCache = new Map<string, string>();

function getBlobUrlFor(kind: "image" | "audio" | "file", attId: string): Promise<string | null> {
  const key = `${kind}:${attId}`;
  const cached = __blobCache.get(key);
  if (cached) return Promise.resolve(cached);
  const ctx = getEditorAuthContext();
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
    document.querySelectorAll(".memo-image-block.is-selected").forEach((el) => {
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
export function hydrateAttachmentsIn(
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
      if (__selectedAttachmentId === id) outer.classList.add("is-selected");

      const img = document.createElement("img");
      img.alt = label;
      img.className =
        "memo-attachment-img max-h-[70vh] w-full max-w-full rounded-lg border border-ink-900/10 object-contain";
      img.style.display = "block";
      img.style.userSelect = "none";
      img.draggable = false;
      img.style.cursor = "pointer";
      img.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        setSelectedAttachment(id, outer);
      });

      const toolbar = document.createElement("span");
      toolbar.className =
        "memo-image-toolbar absolute left-2 top-2 z-10 gap-1 rounded-md bg-white/90 p-1 text-[11px] shadow-sm ring-1 ring-ink-900/10";
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
        requestAnimationFrame(() => view.focus());
      });

      const handle = document.createElement("span");
      handle.className =
        "memo-image-resize-handle absolute bottom-1 right-1 h-4 w-4 cursor-nwse-resize rounded-sm bg-white/90 shadow-sm ring-1 ring-ink-900/15";
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

      void getBlobUrlFor("image", id).then((u) => {
        if (u) img.src = u;
      });
      outer.append(img, toolbar, removeBtn, handle);
      node.replaceChildren(outer);
    } else if (kind === "audio") {
      const wrap = document.createElement("span");
      wrap.className =
        "memo-attachment-audio-wrap inline-flex items-center gap-2 rounded-md bg-ink-900/5 px-2 py-1 text-[12px] text-ink-900/70";
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

export function hydrateWikilinksIn(root: HTMLElement): void {
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
      invokeNavigateLink(title);
    });
  }
}
