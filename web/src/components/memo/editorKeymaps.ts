import { redo, undo } from "@codemirror/commands";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { parseChecklistLine, parseQuoteLine } from "./markdown";
import { isAttachmentLineText, removeWholeAttachmentLine } from "./editorAttachmentLine";

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
          if (sel.head !== line.from) {
            view.dispatch({
              selection: { anchor: line.from },
              scrollIntoView: true,
            });
            return true;
          }
          return true;
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
      key: "Enter",
      run(view) {
        const { state } = view;
        const sel = state.selection.main;
        if (!sel.empty) return false;
        const line = state.doc.lineAt(sel.head);

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

export const editorUndoRedoKeymap = Prec.highest(
  keymap.of([
    { key: "Mod-z", run: undo },
    { key: "Mod-y", run: redo },
    { key: "Mod-Shift-z", run: redo },
  ]),
);

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
