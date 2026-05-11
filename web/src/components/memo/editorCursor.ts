import { EditorView } from "@codemirror/view";
import { syncCursorFromView, syncLastDocCursorFromState } from "./editorGlobals";

export const editorCursorTracker = EditorView.updateListener.of((u) => {
  if (u.selectionSet || u.docChanged || u.focusChanged) {
    syncLastDocCursorFromState(u.state);
  }
});

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
