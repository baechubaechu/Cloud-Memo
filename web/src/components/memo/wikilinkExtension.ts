// CodeMirror 가 직접 들고 있는 위키링크 자동완성. 이전에는 React state 기반
// 오버레이 메뉴(`wikilinkMenu`) + 별도 키보드 effect + Space 확정 keymap 까지
// 끼어 있어, 메뉴를 클릭하거나 Enter 로 선택할 때마다 CodeMirror selection 과
// DOM selection 이 어긋나면서 캐럿이 본문 맨 앞으로 튀거나 raw / render 가
// 즉시 / 지연 / 안 됨이 들쭉날쭉했다.
//
// 이 모듈은 `@codemirror/autocomplete` 의 정식 확장 한 줄로 동일한 UX 를 만든다.
//   - completion source 가 doc 안에서 `[[query` 패턴을 직접 본다 → React state
//     동기화가 필요 없다.
//   - completion 을 골랐을 때 한 번의 transaction 으로 `[[Title]] `(트레일링
//     스페이스 포함) 을 박고 selection 을 그 뒤로 옮긴다 → 항상 즉시 위젯/링크
//     로 렌더된다.
//   - 새 노트는 별도 callback 으로 백그라운드에서만 만들고, 본문에는 동일하게
//     `[[Title]] ` 만 박는다 → 만든 직후엔 raw 처럼 보이지 않고 곧장 렌더된다.

import {
  autocompletion,
  closeBrackets,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorState, Extension, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Workbench 가 알고 있는 노트 한 개의 식별 정보. completion 후보로 사용. */
export type WikilinkNoteCandidate = {
  id: string;
  title: string;
};

export type WikilinkExtensionOptions = {
  /** 현재 사이드바에 보이는 노트 목록. 매번 최신 배열을 돌려주는 콜백이어야 한다. */
  getNotes: () => WikilinkNoteCandidate[];
  /** 사용자가 "+ 새 노트 만들기" 항목을 골랐을 때 백그라운드 노트 생성. */
  createNote: (title: string) => void;
};

const NEW_NOTE_BOOST = -1; // 항상 기존 노트가 위에 오도록 약간 낮춰둔다.

/**
 * `[[` 다음에 `[`/`]`/줄바꿈을 포함하지 않는 임의 텍스트가 캐럿까지 이어질 때만
 * 자동완성 메뉴를 연다. `[[`만 친 직후에도 메뉴가 떠야 하므로 query 는 빈 문자열도 허용.
 */
function matchWikilinkTrigger(state: EditorState, pos: number): { from: number; query: string } | null {
  const line = state.doc.lineAt(pos);
  const offset = pos - line.from;
  const before = line.text.slice(0, offset);
  const m = before.match(/\[\[([^\[\]\n]*)$/);
  if (!m) return null;
  const query = m[1] ?? "";
  return { from: pos - query.length - 2, query };
}

/**
 * 사용자가 `[[abc` 까지 친 다음 메뉴에서 항목을 고르면, 그 시점에 doc 의 캐럿
 * 뒤에 closeBrackets 가 만들어둔 `]]` (또는 `]`) 가 남아있을 수 있다. 한 번의
 * transaction 으로 그 잔여물까지 같이 먹어 `[[Title]] ` 로 치환한다. 트레일링
 * 스페이스를 포함시키는 이유는 buildHybridDecorations 가 `링크 뒤 공백` 을
 * "확정된 위키링크" 의 신호로 쓰기 때문 — 즉시 위젯으로 렌더된다.
 */
type ApplyFn = (view: EditorView, completion: Completion, from: number, to: number) => void;

function applyCompletion(title: string, triggerFrom: number): ApplyFn {
  const safeTitle = title.replace(/[\[\]\n]/g, " ").trim();
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const state = view.state;
    const docLen = state.doc.length;
    const start = Math.min(Math.max(0, triggerFrom), docLen);
    let end = Math.min(Math.max(start, to), docLen);
    const trailing = state.doc.sliceString(end, Math.min(docLen, end + 2));
    if (trailing.startsWith("]]")) {
      end = Math.min(docLen, end + 2);
    } else if (trailing.startsWith("]")) {
      end = Math.min(docLen, end + 1);
    }
    const insert = `[[${safeTitle}]] `;
    const cursor = start + insert.length;
    view.dispatch({
      changes: { from: start, to: end, insert },
      selection: { anchor: cursor },
      scrollIntoView: true,
      userEvent: "input.wikilink.confirm",
    });
    // dispatch 자체로 focus 가 빠지진 않지만 일부 환경에서 메뉴 closeOnBlur 시점에
    // body 로 포커스가 넘어가는 케이스가 있어 한 번 더 보장해 둔다.
    view.focus();
    void from; // 사용 안 함 — 명시적으로 무시.
  };
}

function buildSource(opts: WikilinkExtensionOptions) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const trigger = matchWikilinkTrigger(ctx.state, ctx.pos);
    if (!trigger) return null;
    // 명시적 호출이 아니면 `[[` 직후만으로는 메뉴를 띄우지 않는다 ... 라고 두면
    // `[[` 만 친 사용자가 메뉴를 못 보므로 항상 띄운다.
    void ctx.explicit;

    const needle = trigger.query.trim().toLowerCase();
    const notes = opts.getNotes();

    const matched = notes
      .filter((n) => {
        if (!needle) return true;
        return (n.title || "").toLowerCase().includes(needle);
      })
      .slice()
      .sort((a, b) => {
        const at = (a.title || "").toLowerCase();
        const bt = (b.title || "").toLowerCase();
        if (needle) {
          const aStarts = at.startsWith(needle) ? 0 : 1;
          const bStarts = bt.startsWith(needle) ? 0 : 1;
          if (aStarts !== bStarts) return aStarts - bStarts;
        }
        return at.localeCompare(bt, "ko");
      })
      .slice(0, 8);

    const options: Completion[] = matched.map((n) => {
      const label = n.title || "(무제 노트)";
      return {
        label,
        type: "wikilink",
        detail: "기존 노트",
        apply: applyCompletion(label, trigger.from),
      };
    });

    const trimmed = trigger.query.trim();
    const exactExists = trimmed
      ? notes.some((n) => (n.title || "").toLowerCase() === trimmed.toLowerCase())
      : false;
    if (trimmed && !exactExists) {
      const title = trimmed;
      options.push({
        // 직선 따옴표만 쓴다. 타이포그래픽 따옴표는 일부 글꼴에서 보조 설명 줄과 톤이 달라 보일 수 있음.
        label: `+ 새 노트 "${title}"`,
        type: "wikilink-create",
        detail: "이 제목으로 새 노트 만들기",
        boost: NEW_NOTE_BOOST,
        apply: (view, completion, from, to) => {
          // 1) doc 에는 다른 기존 링크와 동일한 `[[Title]] ` 를 박는다.
          applyCompletion(title, trigger.from)(view, completion, from, to);
          // 2) 그 후 background 로 노트 생성. 만들어진 노트는 reload 후 next
          //    `[[` 메뉴에서 검색되며, 본문에 박힌 링크는 클릭 시
          //    navigateToWikilink 가 같은 제목으로 다시 한 번 보거나 새로 만든다.
          opts.createNote(title);
        },
      });
    }

    return {
      from: trigger.from + 2, // `[[` 뒤부터 query.
      to: ctx.pos,
      options,
      // 사용자가 `]` 나 줄바꿈을 입력하면 매치가 깨지므로 메뉴를 닫는다.
      validFor: /^[^\[\]\n]*$/,
    };
  };
}

/**
 * Workbench 의 CodeMirror extensions 배열에 그대로 펼칠 수 있는 위키링크 확장 묶음.
 *   - autocompletion: `[[` 패턴에서만 발동하는 single source.
 *   - closeBrackets: 사용자가 직접 `[[]]` 를 칠 때 닫는 괄호 자동 보정.
 */
export function wikilinkAutocompleteExtension(opts: WikilinkExtensionOptions): Extension {
  return [
    closeBrackets(),
    autocompletion({
      override: [buildSource(opts)],
      activateOnTyping: true,
      defaultKeymap: true,
      icons: false,
      closeOnBlur: true,
      /** `editorTheme.ts` 의 `.memo-wikilink-completion` 스타일과 짝 */
      tooltipClass: () => "memo-wikilink-completion",
      optionClass: (c: Completion) =>
        c.type === "wikilink-create" ? "memo-wikilink-completion-new" : "memo-wikilink-completion-existing",
    }),
  ];
}

// 사용 안 함 import 경고를 막기 위한 타입 re-export. (Transaction 타입은 향후
// dispatch 시그니처 검증용으로 남겨두지만 지금은 직접 사용하지 않는다.)
export type { Transaction };
