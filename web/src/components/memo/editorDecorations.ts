import { StateField, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import {
  headingLevelClass,
  isWikilinkEditPosition,
  parseAttachmentLine,
  parseChecklistLine,
  parseQuoteLine,
  parseWikilinks,
} from "./markdown";
import {
  ChecklistPrefixWidget,
  QuotePrefixWidget,
  RenderedMarkdownLineWidget,
  WikilinkInlineWidget,
} from "./editorWidgets";

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
    const isAttachment = parseAttachmentLine(line.text) !== null;
    if (i === activeLineNo && !isAttachment) {
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
      const activeQuote = parseQuoteLine(line.text);
      if (activeQuote) {
        lineDecos.push(Decoration.line({ class: "memo-quote-line" }).range(line.from));
        const prefixEnd = line.from + activeQuote.prefixLen;
        markDecos.push(
          Decoration.replace({ widget: new QuotePrefixWidget() }).range(line.from, prefixEnd),
        );
      }
      for (const link of parseWikilinks(line.text)) {
        const linkFrom = line.from + link.from;
        const linkTo = line.from + link.to;
        const cursorInside = selMain.empty && isWikilinkEditPosition(line.text, link, selMain.head - line.from);
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
