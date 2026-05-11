import { EditorView } from "@codemirror/view";
import { getMemoEditorContext } from "./editorContext";
import { isLastDocCursorExplicit, syncCursorFromView } from "./editorGlobals";

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
    if (files.length === 0) return false;
    ev.preventDefault();
    ev.stopPropagation();
    syncCursorFromView(view, true);
    const ctx = getMemoEditorContext(view);
    if (!ctx) return true;
    for (const f of files) ctx.insertFile(f);
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
    if (!isLastDocCursorExplicit()) {
      const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY });
      if (typeof pos === "number") {
        view.dispatch({ selection: { anchor: pos } });
        syncCursorFromView(view, true);
      } else {
        const end = view.state.doc.length;
        view.dispatch({ selection: { anchor: end } });
        syncCursorFromView(view, true);
      }
    }
    const ctxDrop = getMemoEditorContext(view);
    if (!ctxDrop) return true;
    for (const f of files) ctxDrop.insertFile(f);
    return true;
  },
});
