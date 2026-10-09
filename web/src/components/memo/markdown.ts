import { wikilinkDisplayLabel } from "./wikilinkPaths";

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * 본문 안에서 사용하는 첨부 마커 포맷.
 *
 *   이미지:  `![${name}](attachment://${id})`
 *   오디오:  `![audio:${name}](attachment://${id})`     (alt 가 audio: 로 시작)
 *   파일:    `[${name}](attachment://${id})`
 *
 * id 는 attachments 테이블의 UUID. 본문에는 텍스트만 저장되고,
 * 렌더 시점에 editor 모듈이 인증 토큰을 사용해 실제 미디어로 교체한다.
 */
export type AttachmentMarkerKind = "image" | "audio" | "file";
export type AttachmentImageAlign = "left" | "center" | "right";
export type AttachmentMarker = {
  kind: AttachmentMarkerKind;
  id: string;
  /** 사용자에게 보여줄 라벨 (alt 또는 link text). */
  label: string;
  /** 이미지 블록 렌더 폭(px). 기존 마커에는 없을 수 있다. */
  width?: number;
  /** 이미지 블록 정렬. 기존 마커에는 없을 수 있다. */
  align?: AttachmentImageAlign;
};

const ATTACHMENT_URL = /attachment:\/\/([0-9a-fA-F-]{8,})/;
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(attachment:\/\/([0-9a-fA-F-]{8,})\)\s*$/;
const FILE_LINE_RE = /^\[([^\]]*)\]\(attachment:\/\/([0-9a-fA-F-]{8,})\)\s*$/;

function parseImageAlt(alt: string): Pick<AttachmentMarker, "label" | "width" | "align"> {
  const parts = alt.split("|");
  const labelParts = [parts[0] || ""];
  let width: number | undefined;
  let align: AttachmentImageAlign | undefined;
  for (const part of parts.slice(1)) {
    const trimmed = part.trim();
    const widthMatch = trimmed.match(/^w=(\d{2,4})$/);
    if (widthMatch) {
      const next = Number(widthMatch[1]);
      if (Number.isFinite(next)) width = Math.min(1200, Math.max(80, next));
      continue;
    }
    const alignMatch = trimmed.match(/^align=(left|center|right)$/);
    if (alignMatch) {
      align = alignMatch[1] as AttachmentImageAlign;
      continue;
    }
    labelParts.push(part);
  }
  return { label: labelParts.join("|").trim(), width, align };
}

export function serializeAttachmentMarker(m: AttachmentMarker): string {
  const safeLabel = m.label.replaceAll("]", "").replaceAll("[", "").replaceAll("\n", " ");
  if (m.kind === "image") {
    const meta: string[] = [];
    if (m.width) meta.push(`w=${Math.min(1200, Math.max(80, Math.round(m.width)))}`);
    if (m.align) meta.push(`align=${m.align}`);
    const alt = [safeLabel, ...meta].filter(Boolean).join("|");
    return `![${alt}](attachment://${m.id})`;
  }
  if (m.kind === "audio") return `![audio:${safeLabel}](attachment://${m.id})`;
  return `[${safeLabel || "첨부 파일"}](attachment://${m.id})`;
}

export function parseAttachmentLine(line: string): AttachmentMarker | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("!") && !trimmed.startsWith("[")) return null;
  if (!ATTACHMENT_URL.test(trimmed)) return null;

  const img = trimmed.match(IMAGE_LINE_RE);
  if (img) {
    const alt = img[1] || "";
    const id = img[2];
    if (alt.startsWith("audio:")) {
      return { kind: "audio", id, label: alt.slice("audio:".length).trim() };
    }
    return { kind: "image", id, ...parseImageAlt(alt) };
  }
  const file = trimmed.match(FILE_LINE_RE);
  if (file) {
    return { kind: "file", id: file[2], label: file[1] || "첨부 파일" };
  }
  return null;
}

/** editor.ts 가 후처리할 수 있도록 placeholder HTML 을 만든다. */
function renderAttachmentPlaceholderHtml(m: AttachmentMarker): string {
  const safeLabel = escapeHtml(m.label);
  const idAttr = escapeHtml(m.id);
  if (m.kind === "image") {
    const widthAttr = m.width ? ` data-att-width="${m.width}"` : "";
    const alignAttr = m.align ? ` data-att-align="${m.align}"` : "";
    return `<span class="memo-attachment memo-attachment-image" data-att-id="${idAttr}" data-att-kind="image" data-att-label="${safeLabel}"${widthAttr}${alignAttr}><span class="memo-attachment-fallback">\u{1F5BC} ${safeLabel || "이미지"}</span></span>`;
  }
  if (m.kind === "audio") {
    return `<span class="memo-attachment memo-attachment-audio" data-att-id="${idAttr}" data-att-kind="audio" data-att-label="${safeLabel}"><span class="memo-attachment-fallback">\u{1F3A4} ${safeLabel || "음성"}</span></span>`;
  }
  return `<span class="memo-attachment memo-attachment-file" data-att-id="${idAttr}" data-att-kind="file" data-att-label="${safeLabel}"><span class="memo-attachment-fallback">\u{1F4CE} ${safeLabel || "파일"}</span></span>`;
}

export function renderInlineMarkdown(s: string): string {
  let out = s.split(/(\[\[[^\[\]\n]+\]\])/g).map((part) => {
    const match = part.match(/^\[\[([^\[\]\n]+)\]\]$/);
    if (!match) return escapeHtml(part);
    const target = escapeHtml(match[1]);
    const label = escapeHtml(wikilinkDisplayLabel(match[1]));
    return `<a class="memo-wikilink text-indigo-700 underline underline-offset-2" href="#" data-link="${target}" title="${target}">${label}</a>`;
  }).join("");
  // Markdown link: [text](url)
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    `<a class="text-sky-700 underline underline-offset-2" href="$2" target="_blank" rel="noreferrer">$1</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`([^`]+)`/g, '<code class="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.9em]">$1</code>');
  return out;
}

export type WikilinkRange = {
  from: number;
  to: number;
  title: string;
};

export function isWikilinkEditPosition(line: string, link: WikilinkRange, cursor: number): boolean {
  const from = link.from > 0 && /[ \t]/.test(line[link.from - 1]) ? link.from - 1 : link.from;
  const to = link.to < line.length && /[ \t]/.test(line[link.to]) ? link.to + 1 : link.to;
  return cursor >= from && cursor <= to;
}

export function parseWikilinks(line: string): WikilinkRange[] {
  const out: WikilinkRange[] = [];
  const re = /\[\[([^\[\]\n]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out.push({
      from: m.index,
      to: m.index + m[0].length,
      title: m[1],
    });
  }
  return out;
}

export type ChecklistLine = {
  checked: boolean;
  text: string;
  /** `[ ]` / `[x]` 내부 상태 문자의 raw offset. */
  stateOffset: number;
  /** 리스트/체크박스 prefix 이후 본문 시작 raw offset. */
  textOffset: number;
};

export function parseChecklistLine(line: string): ChecklistLine | null {
  const m = line.match(/^(\s*[-*]\s+\[)( |x|X)(\]\s+)(.*)$/);
  if (!m) return null;
  return {
    checked: m[2].toLowerCase() === "x",
    text: m[4],
    stateOffset: m[1].length,
    textOffset: m[1].length + m[2].length + m[3].length,
  };
}

export type QuoteLine = {
  /** 줄 시작의 들여쓰기. */
  indent: string;
  /** `> ` 까지 합친 prefix 길이 (raw line 기준). */
  prefixLen: number;
  /** prefix 다음 본문. */
  text: string;
};

/** `> 본문` 또는 `   > 본문` 형태의 인용 줄을 인식한다. `>` 다음 공백 1개 이상 필수. */
export function parseQuoteLine(line: string): QuoteLine | null {
  const m = line.match(/^(\s*)>(\s+)(.*)$/);
  if (!m) return null;
  const indent = m[1] ?? "";
  const space = m[2] ?? " ";
  return {
    indent,
    prefixLen: indent.length + 1 + space.length,
    text: m[3] ?? "",
  };
}

export function renderMarkdownLineHtml(line: string): string {
  if (!line.trim()) return "&nbsp;";
  const att = parseAttachmentLine(line);
  if (att) return renderAttachmentPlaceholderHtml(att);
  const checklist = parseChecklistLine(line);
  if (checklist) {
    const checkedAttr = checklist.checked ? ' aria-checked="true" data-checked="true"' : ' aria-checked="false"';
    const mark = checklist.checked ? "✓" : "";
    const textCls = checklist.checked ? "line-through text-ink-900/45" : "text-ink-900";
    return `<span class="memo-checklist-line inline-flex items-start gap-2"><button type="button" role="checkbox"${checkedAttr} class="memo-checklist-box mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded border border-ink-900/25 bg-white text-[11px] leading-none text-white data-[checked=true]:border-emerald-500 data-[checked=true]:bg-emerald-500" data-checklist-toggle="1">${mark}</button><span class="${textCls}">${renderInlineMarkdown(checklist.text)}</span></span>`;
  }
  const heading = line.match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
    const level = Math.min(6, heading[1].length);
    const cls =
      level === 1
        ? "text-3xl font-semibold"
        : level === 2
          ? "text-2xl font-semibold"
          : level === 3
            ? "text-xl font-semibold"
            : "text-lg font-semibold";
    return `<span class="${cls}">${renderInlineMarkdown(heading[2])}</span>`;
  }
  const item = line.match(/^[-*]\s+(.+)$/);
  if (item) return `&bull; ${renderInlineMarkdown(item[1])}`;
  if (line.startsWith("> ")) {
    return `<span class="border-l-2 border-ink-900/20 pl-2 text-ink-900/75">${renderInlineMarkdown(line.slice(2))}</span>`;
  }
  return renderInlineMarkdown(line);
}

export function headingLevelClass(line: string): string | null {
  const m = line.match(/^(#{1,6})\s+/);
  if (!m) return null;
  const level = Math.min(6, m[1].length);
  if (level === 1) return "cm-heading-l1";
  if (level === 2) return "cm-heading-l2";
  if (level === 3) return "cm-heading-l3";
  return "cm-heading-l4";
}

// 원문 line의 raw offset을 렌더된 텍스트의 offset으로 변환 (마크다운 prefix 보정).
export function getRenderedOffset(rawLine: string, rawOffset: number): number {
  const heading = rawLine.match(/^(#{1,6})\s+/);
  if (heading) return Math.max(0, rawOffset - heading[0].length);
  const checklist = parseChecklistLine(rawLine);
  if (checklist) return Math.max(0, rawOffset - checklist.textOffset);
  if (rawLine.startsWith("> ")) return Math.max(0, rawOffset - 2);
  return rawOffset;
}
