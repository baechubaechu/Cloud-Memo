/**
 * CodeMirror Facet 으로 에디터 인스턴스별 컨텍스트를 주입한다.
 * (토큰·API URL·파일 삽입·위키링크 이동) — 전역 슬롯 대신 view.state 에만 존재.
 */

import { Facet } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** 단일 메모 에디터에 필요한 주입 의존성. */
export type MemoEditorContext = {
  token: string;
  apiUrl: string;
  insertFile: (file: File) => void;
  navigateLink: (title: string) => void;
};

export const memoEditorContextFacet = Facet.define<MemoEditorContext | null, MemoEditorContext | null>({
  combine: (values) => {
    for (let i = values.length - 1; i >= 0; i--) {
      const v = values[i];
      if (v != null) return v;
    }
    return null;
  },
});

export function memoEditorContextExtension(ctx: MemoEditorContext): Extension {
  return memoEditorContextFacet.of(ctx);
}

export function getMemoEditorContext(view: EditorView): MemoEditorContext | null {
  return view.state.facet(memoEditorContextFacet);
}

/**
 * Workbench 가 `extensions` 배열에 넣기 쉬운 형태. 지금은 Facet 한 겹만 반환하고,
 * 이후 다른 주입형 확장을 같이 묶을 수 있다.
 */
export function createMemoEditorExtensions(ctx: MemoEditorContext): Extension[] {
  return [memoEditorContextExtension(ctx)];
}
