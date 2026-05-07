export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
