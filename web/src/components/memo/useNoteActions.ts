// 열린 노트에 대한 동작들: 새 노트·오늘 노트 만들기, 폴더 옮기기, 태그 붙이기·만들기,
// 즐겨찾기·아카이브, 버전 되돌리기, 백링크·할 일에서 특정 줄로 열기. Workbench 에서 분리.

import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import type { NoteDetail, NoteVersion, Tag } from "@/lib/api";
import { api } from "@/lib/api";
import type { EditorSession } from "./useEditorSession";
import { REASON_LABEL } from "./utils";
import { todayNoteTitle } from "./workbenchHelpers";

type Options = {
  token: string;
  session: EditorSession;
  /** 링크 갱신 알림을 띄우는 api.patchNote 래퍼. */
  patchNote: typeof api.patchNote;
  activateFreshDraft: (draft: NoteDetail) => Promise<void>;
  loadNote: (id: string) => Promise<void>;
  reloadNotes: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  tags: Tag[];
  /** 태그를 골라 둔 목록에서 새 노트를 만들면 그 태그를 붙인다. */
  selectedTagId: string | undefined;
  setSelectedFolderId: Dispatch<SetStateAction<string | undefined>>;
  expandFolder: (folderId: string) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setLinkNotice: Dispatch<SetStateAction<{ count: number } | null>>;
  handleApiError: (e: unknown) => void;
};

export function useNoteActions(options: Options) {
  const {
    token,
    session,
    patchNote,
    activateFreshDraft,
    loadNote,
    reloadNotes,
    refreshMeta,
    tags,
    selectedTagId,
    setSelectedFolderId,
    expandFolder,
    setError,
    setLinkNotice,
    handleApiError,
  } = options;
  const { activeNoteId, activeNote, setActiveNote, activeNoteIdRef, editorViewRef, setSaveState } = session;

  async function handleNewNoteIn(folderId: string | null) {
    try {
      setError(null);
      const draft = await api.createNote(token, {
        folder_id: folderId,
        tag_ids: selectedTagId ? [selectedTagId] : [],
      });
      await activateFreshDraft(draft);
      if (folderId) expandFolder(folderId);
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleNewNote() {
    try {
      setError(null);
      const draft = await api.createNote(token, {
        folder_id: null,
        tag_ids: selectedTagId ? [selectedTagId] : [],
      });
      await activateFreshDraft(draft);
      setSelectedFolderId(undefined);
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleOpenTodayNote() {
    try {
      setError(null);
      const dailyTitle = todayNoteTitle();
      const rows = await api.listNotes(token, { archived: false, trash: false });
      const existing = rows.find((n) => (n.title || "").trim() === dailyTitle);
      if (existing) {
        await loadNote(existing.id);
        return;
      }
      const draft = await api.createNote(token, {
        title: dailyTitle,
        content: `# ${dailyTitle}\n\n`,
        folder_id: null,
        tag_ids: [],
      });
      await activateFreshDraft(draft);
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleMoveNoteFolder(ev: ChangeEvent<HTMLSelectElement>) {
    if (!activeNoteId || !activeNote) return;
    const id = ev.target.value;
    try {
      setSaveState("saving");
      const updated = await patchNote(token, activeNoteId, { folder_id: id || null });
      setActiveNote(updated);
      setSaveState("saved");
      void reloadNotes();
    } catch (e) {
      handleApiError(e);
      setSaveState("dirty");
    }
  }

  async function toggleTagForActive(tag: Tag, checked: boolean) {
    if (!activeNoteId || !activeNote) return;
    const current = new Set(activeNote.tags.map((t) => t.id));
    if (checked) current.add(tag.id);
    else current.delete(tag.id);
    try {
      setSaveState("saving");
      const updated = await api.setNoteTags(token, activeNoteId, Array.from(current));
      setActiveNote(updated);
      setSaveState("saved");
      void reloadNotes();
    } catch (e) {
      handleApiError(e);
      setSaveState("dirty");
    }
  }

  /** 이름으로 태그를 만들어(이미 있으면 그 태그를) 현재 노트에 붙인다. */
  async function createTagForActive(rawName: string) {
    const name = rawName.trim().replace(/^#+/, "").trim();
    if (!name || !activeNoteId || !activeNote) return;
    try {
      const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
      const tag = existing ?? (await api.createTag(token, name));
      if (!existing) await refreshMeta();
      await toggleTagForActive(tag, true);
    } catch (e) {
      handleApiError(e);
    }
  }

  async function toggleFavorite() {
    if (!activeNoteId || !activeNote) return;
    try {
      const updated = await patchNote(token, activeNoteId, { is_favorite: !activeNote.is_favorite });
      setActiveNote(updated);
      void reloadNotes();
    } catch (e) {
      handleApiError(e);
    }
  }

  async function toggleArchive() {
    if (!activeNoteId || !activeNote) return;
    try {
      const updated = await patchNote(token, activeNoteId, { is_archived: !activeNote.is_archived });
      setActiveNote(updated);
      void reloadNotes();
    } catch (e) {
      handleApiError(e);
    }
  }

  async function handleRestoreVersion(v: NoteVersion) {
    if (!activeNoteId) return;
    if (!window.confirm(`버전 #${v.version_index} (${REASON_LABEL[v.reason]}) 으로 되돌릴까요?`)) return;
    try {
      const restored = await api.restoreVersion(token, activeNoteId, v.id);
      if (restored.updated_link_note_count != null) {
        setLinkNotice({ count: restored.updated_link_note_count });
      }
      await loadNote(activeNoteId);
    } catch (e) {
      handleApiError(e);
    }
  }

  /** 노트를 열고 해당 줄(0부터)로 캐럿을 옮긴다 — 백링크·할 일 패널에서 쓴다. */
  async function openNoteAtLine(noteId: string, lineIndex: number): Promise<void> {
    if (activeNoteIdRef.current !== noteId) await loadNote(noteId);
    // 노트가 바뀌면 에디터가 새로 만들어진다. 화면에 올라온 뒤에 옮긴다.
    window.setTimeout(() => {
      const view = editorViewRef.current;
      if (!view || activeNoteIdRef.current !== noteId) return;
      const doc = view.state.doc;
      const line = doc.line(Math.min(Math.max(1, lineIndex + 1), doc.lines));
      view.dispatch({ selection: { anchor: line.to }, scrollIntoView: true });
      view.focus();
    }, 120);
  }

  return {
    handleNewNoteIn,
    handleNewNote,
    handleOpenTodayNote,
    handleMoveNoteFolder,
    toggleTagForActive,
    createTagForActive,
    toggleFavorite,
    toggleArchive,
    handleRestoreVersion,
    openNoteAtLine,
  };
}
