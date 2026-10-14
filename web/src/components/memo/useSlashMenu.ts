// 본문에서 `/` 를 치면 뜨는 슬래시 메뉴: 열림 상태·위치, 후보 필터, 키보드 선택,
// 고른 명령으로 `/쿼리` 토큰 바꾸기. Workbench 에서 분리.

import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { EditorView } from "@codemirror/view";
import { buildSlashCommands } from "./workbenchCommands";
import type { SlashMenuState } from "./workbenchTypes";

type Options = {
  editorViewRef: RefObject<EditorView | null>;
  /** 메뉴 위치를 모를 때(메뉴 밖에서 명령 실행) 캐럿에 텍스트를 넣는 함수. */
  insertTextAtCursor: (text: string) => boolean;
  imageInputRef: RefObject<HTMLInputElement | null>;
  setDrawingMode: Dispatch<SetStateAction<boolean>>;
  startAudioRecording: () => void | Promise<void>;
  /** 다른 대화상자가 떠 있으면 메뉴 키보드 처리를 멈춘다. */
  suspended: boolean;
};

export function useSlashMenu(options: Options) {
  const { editorViewRef, insertTextAtCursor, imageInputRef, setDrawingMode, startAudioRecording, suspended } = options;
  const [slashMenu, setSlashMenu] = useState<SlashMenuState>(null);
  // 키보드/호버로 선택 중인 항목 인덱스. 메뉴가 열려 있는 동안만 의미 있음.
  const [slashSelected, setSlashSelected] = useState(0);

  function replaceSlashCommand(insertText: string): boolean {
    const view = editorViewRef.current;
    if (!view || !slashMenu) return insertTextAtCursor(insertText);
    // 클릭/Enter 시점에 view.state.selection 을 다시 읽으면, 일부 환경에서
    // 포커스 이동/이벤트 순서 때문에 selection 이 0 으로 초기화돼 본문 맨
    // 앞에 박혀버리는 사고가 난다. 그래서 메뉴를 열었을 때 잡아둔
    // slashMenu.from / slashMenu.to 를 그대로 신뢰해 사용한다.
    const docLen = view.state.doc.length;
    const from = Math.min(Math.max(0, slashMenu.from), docLen);
    const to = Math.min(Math.max(from, slashMenu.to), docLen);
    view.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: from + insertText.length },
      scrollIntoView: true,
    });
    // 실행 직후 무조건 메뉴 닫기. 같은 update 사이클에서 listener 가 다시
    // 발동해 재오픈되는 걸 막기 위해 setSlashMenu 도 즉시 호출한다.
    setSlashMenu(null);
    setSlashSelected(0);
    // setSlashMenu state flush 후 포커스를 잡아 다음 keydown 이 본문으로 들어가게.
    requestAnimationFrame(() => view.focus());
    return true;
  }

  function updateFromView(view: EditorView): void {
    const sel = view.state.selection.main;
    if (!sel.empty) {
      setSlashMenu((prev) => (prev === null ? prev : null));
      return;
    }
    const line = view.state.doc.lineAt(sel.head);
    const beforeCursor = line.text.slice(0, sel.head - line.from);
    const match = beforeCursor.match(/(^|\s)\/([\w가-힣]*)$/);
    if (!match) {
      setSlashMenu((prev) => (prev === null ? prev : null));
      return;
    }
    const queryText = match[2] ?? "";
    const from = sel.head - queryText.length - 1;
    // 캐럿 픽셀 좌표를 잡아 메뉴를 바로 옆에 띄운다. coordsAtPos 가 null 이면
    // (마운트 직후/가상화) 화면 좌상단쯤으로 fallback.
    let x = 24;
    let y = 80;
    const cursorRect = view.coordsAtPos(sel.head);
    if (cursorRect) {
      x = cursorRect.left;
      y = cursorRect.bottom + 4;
    }
    setSlashMenu((prev) => {
      // 같은 위치/쿼리면 재할당하지 않아 무한 렌더 루프를 막는다. listener 가
      // reconfigure 등 비입력 update 에도 fire 되기 때문에 필수 가드.
      if (
        prev &&
        prev.from === from &&
        prev.to === sel.head &&
        prev.query === queryText &&
        prev.x === x &&
        prev.y === y
      ) {
        return prev;
      }
      return { from, to: sel.head, query: queryText, x, y };
    });
  }

  // 확장은 한 번만 만들고, 최신 updateFromView 는 ref 로 읽는다.
  const updateRef = useRef(updateFromView);
  updateRef.current = updateFromView;

  // CodeMirror 입력/선택 변경 시 슬래시 메뉴 후보를 다시 평가한다.
  // updateListener 가 한 박자 늦게 fire 되는 환경(IME 조합 직후 등) 을 대비해
  // native input/keyup 에서도 한 번 더 평가하고, onChange 에서도 직접 부른다.
  const slashMenuExtension = useMemo(
    () => [
      EditorView.updateListener.of((u) => {
        if (!u.docChanged && !u.selectionSet && !u.focusChanged) return;
        const view = u.view;
        queueMicrotask(() => updateRef.current(view));
      }),
      EditorView.domEventHandlers({
        input: (_e, view) => {
          queueMicrotask(() => updateRef.current(view));
        },
        keyup: (_e, view) => {
          queueMicrotask(() => updateRef.current(view));
        },
      }),
    ],
    [],
  );

  const slashCommands = buildSlashCommands({
    imageInputRef,
    setDrawingMode,
    startAudioRecording,
    replaceSlashCommand,
  });
  const needle = slashMenu?.query.trim().toLowerCase() ?? "";
  const filteredSlashCommands = slashCommands.filter((cmd) => {
    if (!needle) return true;
    return `${cmd.title} ${cmd.description} ${cmd.keywords}`.toLowerCase().includes(needle);
  });

  // 메뉴 열림 / 쿼리 변동 시 선택 인덱스 0 으로 리셋. 필터 결과가 줄어들면
  // 인덱스가 범위 밖으로 갈 수 있어서 그것도 클램프한다.
  useEffect(() => {
    if (!slashMenu) {
      setSlashSelected(0);
      return;
    }
    setSlashSelected((prev) => {
      const max = Math.max(0, filteredSlashCommands.length - 1);
      if (prev > max) return 0;
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashMenu?.from, slashMenu?.query, filteredSlashCommands.length]);

  useEffect(() => {
    if (!slashMenu || suspended) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        setSlashMenu(null);
        return;
      }
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        setSlashSelected((i) => Math.min(filteredSlashCommands.length - 1, i + 1));
        return;
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        setSlashSelected((i) => Math.max(0, i - 1));
        return;
      }
      if (ev.key === "Enter" || ev.key === "Tab") {
        const cmd = filteredSlashCommands[slashSelected] ?? filteredSlashCommands[0];
        if (!cmd) return;
        ev.preventDefault();
        cmd.run();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [filteredSlashCommands, slashMenu, slashSelected, suspended]);

  return {
    slashMenu,
    slashSelected,
    setSlashSelected,
    filteredSlashCommands,
    slashMenuExtension,
    /** 본문이 바뀔 때 직접 다시 평가 (onChange 경로). */
    updateFromView,
  };
}
