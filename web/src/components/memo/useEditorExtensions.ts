// 본문 에디터(CodeMirror) 확장 묶음과 위키링크 동작: 링크 클릭으로 노트 열기(없으면 만들기),
// 자동완성의 "새 노트 만들기", 붙여넣기·끌어 놓은 파일 넣기. 확장은 한 번만 만들고 바뀌는
// 데이터·콜백은 ref 로 읽는다. Workbench 에서 분리.

import { useCallback, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Folder } from "@/lib/api";
import { api } from "@/lib/api";
import {
  cmEditorVisualTheme,
  editorChecklistAutoTrigger,
  editorCursorBackupSync,
  editorCursorTracker,
  editorMediaInputHandlers,
  editorMouseHandlers,
  editorNavAndDeleteKeymap,
  editorQuoteEnterKeymap,
  editorUndoRedoKeymap,
  hybridMarkdownField,
  memoEditorContextExtension,
} from "./editor";
import type { EditorSession } from "./useEditorSession";
import { wikilinkAutocompleteExtension } from "./wikilinkExtension";
import { linkCreationLocation, newLinkTarget, resolveLink, type LinkCandidate } from "./wikilinkPaths";

type Options = {
  token: string;
  session: EditorSession;
  folders: Folder[];
  linkCandidates: LinkCandidate[];
  linkCandidatesRef: MutableRefObject<LinkCandidate[]>;
  loadNote: (id: string) => Promise<void>;
  reloadNotes: () => Promise<void>;
  /** 붙여넣거나 끌어 놓은 파일을 올리고 캐럿 위치에 넣는다. */
  uploadAndInsert: (file: File) => Promise<void>;
  slashMenuExtension: Extension;
  setError: Dispatch<SetStateAction<string | null>>;
  handleApiError: (e: unknown) => void;
};

export function useEditorExtensions(options: Options) {
  const {
    token,
    session,
    folders,
    linkCandidates,
    linkCandidatesRef,
    loadNote,
    reloadNotes,
    uploadAndInsert,
    slashMenuExtension,
    setError,
    handleApiError,
  } = options;
  const { activeNoteRef } = session;
  // Facet 컨텍스트의 insert/navigate 는 확장이 안정적이어야 하므로, 최신 구현은 ref 로 전달.
  const memoEditorInsertFileRef = useRef<(file: File) => void>(() => {});
  const memoEditorNavigateLinkRef = useRef<(title: string) => void>(() => {});

  // 같은 제목의 노트가 이미 있으면 그걸 열고, 없으면 새로 만들고 본문에 링크만
  // 박는다. autocomplete 확장에서 "새 노트 만들기" 항목을 고를 때 이 함수를
  // 호출한다. 만든 노트로 곧장 이동하지는 않는다 (사용자가 편집하던 노트의
  // 흐름을 끊지 않기 위해). 그 노트로 가고 싶으면 새로 박힌 위키링크를 클릭하면
  // navigateToWikilink 가 그때 연다.
  const handleCreateNoteFromWikilink = useCallback(
    async (target: string) => {
      const location = linkCreationLocation(target, folders);
      if (!location) {
        setError("링크의 폴더 경로를 찾을 수 없거나 같은 경로가 여러 개 있습니다.");
        return;
      }
      try {
        await api.createNote(token, { title: location.title, folder_id: location.folderId });
        await reloadNotes();
      } catch (e) {
        handleApiError(e);
      }
    },
    [handleApiError, reloadNotes, token, folders],
  );

  // 위키링크 클릭 → 같은 제목 노트로 이동. 없으면 그 자리에서 만든다.
  const navigateToWikilink = useCallback(
    async (rawTitle: string) => {
      const title = rawTitle.trim();
      if (!title) return;
      const matches = resolveLink(title, linkCandidates, activeNoteRef.current?.folder_id ?? null);
      if (matches.length > 1) {
        setError(`'${title}' 링크에 여러 노트가 해당합니다. 선택창에서 폴더 경로를 골라 다시 연결해 주세요.`);
        return;
      }
      try {
        if (matches.length === 1) {
          await loadNote(matches[0].id);
          return;
        }
        const target = newLinkTarget(title, activeNoteRef.current?.folder_id ?? null, folders);
        const location = linkCreationLocation(target, folders);
        if (!location) {
          setError("링크의 폴더 경로를 찾을 수 없거나 같은 경로가 여러 개 있습니다.");
          return;
        }
        const draft = await api.createNote(token, { title: location.title, folder_id: location.folderId });
        await reloadNotes();
        await loadNote(draft.id);
      } catch (e) {
        handleApiError(e);
      }
    },
    [handleApiError, loadNote, linkCandidates, folders, reloadNotes, token],
  );

  memoEditorInsertFileRef.current = (file) => void uploadAndInsert(file);
  memoEditorNavigateLinkRef.current = (title) => void navigateToWikilink(title);

  const memoEditorContextExt = useMemo(
    () =>
      memoEditorContextExtension({
        token,
        apiUrl: api.API_URL,
        insertFile: (file) => memoEditorInsertFileRef.current(file),
        navigateLink: (title) => memoEditorNavigateLinkRef.current(title),
      }),
    [token],
  );

  // 위키링크 autocomplete 확장은 한 번만 구성한다. notes 가 바뀔 때마다 확장을
  // 새로 만들면 CodeMirror 가 reconfig 를 일으켜 무겁고, autocomplete 메뉴가
  // 열려 있는 동안 상태가 깨진다. 그래서 실제 데이터(notes / 노트 생성 콜백) 는
  // ref 로 들고, 확장은 ref 를 통해 항상 최신 클로저를 읽는다.
  const wikilinkFoldersRef = useRef(folders);
  wikilinkFoldersRef.current = folders;
  const wikilinkCreateRef = useRef(handleCreateNoteFromWikilink);
  wikilinkCreateRef.current = handleCreateNoteFromWikilink;
  const wikilinkExt = useMemo(
    () =>
      wikilinkAutocompleteExtension({
        getNotes: () => linkCandidatesRef.current,
        getNewNoteTarget: (title) => newLinkTarget(title, activeNoteRef.current?.folder_id ?? null, wikilinkFoldersRef.current),
        createNote: (title) => void wikilinkCreateRef.current(title),
      }),
    [],
  );

  const codeMirrorExtensions = useMemo(
    () => [
      memoEditorContextExt,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      hybridMarkdownField,
      EditorView.lineWrapping,
      cmEditorVisualTheme,
      editorMouseHandlers,
      editorMediaInputHandlers,
      editorCursorTracker,
      editorCursorBackupSync,
      editorChecklistAutoTrigger,
      editorUndoRedoKeymap,
      editorQuoteEnterKeymap,
      editorNavAndDeleteKeymap,
      slashMenuExtension,
      wikilinkExt,
    ],
    [memoEditorContextExt, slashMenuExtension, wikilinkExt],
  );

  return { navigateToWikilink, codeMirrorExtensions };
}
