import { EditorView } from "@codemirror/view";
import { parseAttachmentLine } from "./markdown";

export function isAttachmentLineText(text: string): boolean {
  return parseAttachmentLine(text) !== null;
}

/** 첨부 마커 한 줄을 통째로 제거(앞뒤 \\n 정리 포함). 키맵·이미지 삭제 버튼 공용. */
export function removeWholeAttachmentLine(
  view: EditorView,
  line: { from: number; to: number },
): boolean {
  const docLen = view.state.doc.length;
  let from: number;
  let to: number;
  if (line.from > 0) {
    from = line.from - 1;
    to = line.to;
  } else if (line.to < docLen) {
    from = 0;
    to = line.to + 1;
  } else {
    from = 0;
    to = docLen;
  }
  view.dispatch({
    changes: { from, to, insert: "" },
    selection: { anchor: from },
    scrollIntoView: true,
    userEvent: "delete.attachment",
  });
  return true;
}
