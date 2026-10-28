// 첨부: 업로드해서 캐럿 위치에 마커 넣기, 편집 영역에 파일 떨어뜨리기, 첨부 패널 업로드·삭제,
// 음성 녹음. Workbench 에서 분리.

import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { Attachment } from "@/lib/api";
import { api } from "@/lib/api";
import { buildAttachmentMarker, insertMarkerAtCursor } from "./editorInsert";
import { useAudioRecorder } from "./useAudioRecorder";
import type { EditorSession } from "./useEditorSession";

type Options = {
  token: string;
  session: EditorSession;
  /** 첨부 패널에서 올리거나 지운 뒤 노트를 다시 읽는다. */
  loadNote: (id: string) => Promise<void>;
  refreshUsage: () => Promise<void>;
  askConfirm: (opts: { title: string; message: string; confirmLabel?: string }) => Promise<boolean>;
  handleApiError: (e: unknown) => void;
  setError: Dispatch<SetStateAction<string | null>>;
};

export function useAttachments(options: Options) {
  const { token, session, loadNote, refreshUsage, askConfirm, handleApiError, setError } = options;
  const { activeNoteId, setActiveNote, editorViewRef, replaceEditorDoc } = session;

  async function handleUpload(files: FileList | null) {
    if (!files?.length || !activeNoteId) return;
    for (let i = 0; i < files.length; i += 1) {
      try {
        await api.uploadAttachment(token, activeNoteId, files.item(i)!);
      } catch (e) {
        handleApiError(e);
      }
    }
    if (activeNoteId) await loadNote(activeNoteId);
    void refreshUsage();
  }

  // 툴바에서 부르는 업로드: 업로드 즉시 본문에 마커 자동 삽입.
  // 주의: loadNote 를 부르면 setContent 로 서버의 (마커 없는) 옛 본문이
  // 화면을 덮어써서 방금 삽입한 마커가 즉시 사라진다. 그래서 메타데이터(첨부 목록)
  // 만 갱신하고 title/content state 는 절대 건드리지 않는다.
  async function uploadAndInsert(file: File, at?: number) {
    if (!activeNoteId) return;
    try {
      const att = await api.uploadAttachment(token, activeNoteId, file);
      insertMarkerAtCursor(editorViewRef.current, buildAttachmentMarker({ ...att }), at);
      // 첨부 패널이 새 항목을 보이게끔 활성 노트 메타만 다시 가져온다.
      try {
        const fresh = await api.getNote(token, activeNoteId);
        setActiveNote(fresh);
      } catch {
        /* 메타 갱신 실패는 치명적이지 않음 */
      }
      void refreshUsage();
    } catch (e) {
      handleApiError(e);
    }
  }

  // 음성 녹음 — 끝나면 업로드해서 캐럿 위치에 넣는다.
  const audioRecorder = useAudioRecorder({
    onRecorded: (file) => uploadAndInsert(file),
    onUnsupported: setError,
    onError: handleApiError,
  });

  async function handleDeleteAttachment(att: Attachment) {
    const ok = await askConfirm({
      title: "첨부 삭제",
      message: `'${att.original_filename}' 첨부를 삭제하시겠어요? 이 작업은 되돌릴 수 없습니다.`,
    });
    if (!ok) return;
    try {
      await api.deleteAttachment(token, att.id);
      // 본문에 남은 마커 줄도 같이 지운다 (안 지우면 깨진 자리표시만 남는다).
      const view = editorViewRef.current;
      if (view) {
        const needle = `(attachment://${att.id})`;
        const cur = view.state.doc.toString();
        const next = cur
          .split("\n")
          .filter((line) => !line.includes(needle))
          .join("\n");
        if (next !== cur) replaceEditorDoc(next);
      }
      if (activeNoteId) await loadNote(activeNoteId);
      void refreshUsage();
    } catch (e) {
      handleApiError(e);
    }
  }

  /** 편집 영역 아무 곳에나 파일을 떨어뜨렸을 때 — 그 줄 끝에 첨부를 넣는다. */
  function handleDropFiles(files: File[], x: number, y: number, widgetLine?: number): void {
    const view = editorViewRef.current;
    let anchor: number | undefined;
    if (view) {
      const doc = view.state.doc;
      if (widgetLine !== undefined && widgetLine >= 1 && widgetLine <= doc.lines) {
        anchor = doc.line(widgetLine).to;
      } else {
        const pos = view.posAtCoords({ x, y });
        anchor = typeof pos === "number" ? doc.lineAt(pos).to : doc.length;
      }
      view.dispatch({ selection: { anchor } });
      view.focus();
    }
    // 여러 개를 한 번에 놓으면 같은 줄 끝에 차례로 붙는다(뒤에 놓은 것이 위로).
    for (const f of files) void uploadAndInsert(f, anchor);
  }

  // 편집 영역 밖(사이드바 등)에 파일을 떨어뜨리면 브라우저가 그 파일을 새 탭으로
  // 열어 버린다. 앱 화면에서는 그 기본 동작을 막는다.
  useEffect(() => {
    const prevent = (ev: DragEvent) => {
      if (ev.dataTransfer && Array.from(ev.dataTransfer.types).includes("Files")) ev.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  return { handleUpload, uploadAndInsert, handleDeleteAttachment, handleDropFiles, audioRecorder };
}
