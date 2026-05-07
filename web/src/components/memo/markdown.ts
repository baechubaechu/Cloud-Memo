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
export type AttachmentMarker = {
  kind: AttachmentMarkerKind;
  id: string;
  /** 사용자에게 보여줄 라벨 (alt 또는 link text). */
  label: string;
};

const ATTACHMENT_URL = /attachment:\/\/([0-9a-fA-F-]{8,})/;
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(attachment:\/\/([0-9a-fA-F-]{8,})\)\s*$/;
const FILE_LINE_RE = /^\[([^\]]*)\]\(attachment:\/\/([0-9a-fA-F-]{8,})\)\s*$/;

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
    return { kind: "image", id, label: alt };
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
    return `<span class="memo-attachment memo-attachment-image" data-att-id="${idAttr}" data-att-kind="image" data-att-label="${safeLabel}"><span class="memo-attachment-fallback">\u{1F5BC} ${safeLabel || "이미지"}</span></span>`;
  }
  if (m.kind === "audio") {
    return `<span class="memo-attachment memo-attachment-audio" data-att-id="${idAttr}" data-att-kind="audio" data-att-label="${safeLabel}"><span class="memo-attachment-fallback">\u{1F3A4} ${safeLabel || "음성"}</span></span>`;
  }
  return `<span class="memo-attachment memo-attachment-file" data-att-id="${idAttr}" data-att-kind="file" data-att-label="${safeLabel}"><span class="memo-attachment-fallback">\u{1F4CE} ${safeLabel || "파일"}</span></span>`;
}

export function renderInlineMarkdown(s: string): string {
  let out = escapeHtml(s);
  // Obsidian wikilink: [[note-name]]
  out = out.replace(
    /\[\[([^\]]+)\]\]/g,
    `<a class="text-sky-700 underline underline-offset-2" href="#" data-link="$1">$1</a>`,
  );
  // Markdown link: [text](url)
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    `<a class="text-sky-700 underline underline-offset-2" href="$2" target="_blank" rel="noreferrer">$1</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`([^`]+)`/g, '<code class="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.9em]">$1</code>');
  return out;
}

export function renderMarkdownLineHtml(line: string): string {
  if (!line.trim()) return "&nbsp;";
  const att = parseAttachmentLine(line);
  if (att) return renderAttachmentPlaceholderHtml(att);
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
  if (rawLine.startsWith("> ")) return Math.max(0, rawOffset - 2);
  return rawOffset;
}
