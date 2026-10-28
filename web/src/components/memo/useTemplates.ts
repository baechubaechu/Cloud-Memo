// 노트 템플릿: 템플릿으로 새 노트 만들기, 현재 노트 캐럿 위치에 넣기, 생성 단축키, 명령 팔레트
// 항목. 템플릿 목록(templateSettings)과 관리창 열림 상태는 Workbench 가 들고 있다. Workbench 에서 분리.

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Folder, NoteDetail, NoteTemplate, TemplateSettings } from "@/lib/api";
import { api } from "@/lib/api";
import { insertTextAtCursor } from "./editorInsert";
import { shortcutLabel, templateShortcut } from "./templateShortcuts";
import { renderTemplate } from "./templateVariables";
import type { EditorSession } from "./useEditorSession";
import { folderLinkPath } from "./wikilinkPaths";
import type { AppCommand } from "./workbenchTypes";

type Options = {
  token: string;
  session: EditorSession;
  templateSettings: TemplateSettings;
  folders: Folder[];
  templateDialog: boolean | null;
  setTemplateDialog: Dispatch<SetStateAction<boolean | null>>;
  /** 확인창·명령 팔레트가 떠 있으면 생성 단축키를 받지 않는다. */
  confirmOpen: boolean;
  paletteOpen: boolean;
  activateFreshDraft: (draft: NoteDetail) => Promise<void>;
  flushDraftForNote: (noteId: string, note: NoteDetail, opts?: { commit?: boolean }) => Promise<boolean>;
  flushOverlayForNote: (noteId: string) => Promise<boolean>;
  setExpandedFolders: Dispatch<SetStateAction<Set<string>>>;
  setSelectedFolderId: Dispatch<SetStateAction<string | undefined>>;
  setError: Dispatch<SetStateAction<string | null>>;
  handleApiError: (e: unknown) => void;
};

export function useTemplates(options: Options) {
  const {
    token,
    session,
    templateSettings,
    folders,
    templateDialog,
    setTemplateDialog,
    confirmOpen,
    paletteOpen,
    activateFreshDraft,
    flushDraftForNote,
    flushOverlayForNote,
    setExpandedFolders,
    setSelectedFolderId,
    setError,
    handleApiError,
  } = options;
  const { activeNote, activeNoteRef, activeNoteIdRef, editorViewRef, titleInputRef, draftTitleRef, composingRef } = session;
  const templateCreationBusy = useRef(false);

  async function handleTemplateNote(template: NoteTemplate) {
    if (templateCreationBusy.current) return false;
    templateCreationBusy.current = true;
    try {
      setError(null);
      const current = activeNoteRef.current;
      if (current && !current.deleted_at) {
        if (!(await flushDraftForNote(current.id, current, { commit: true })) || !(await flushOverlayForNote(current.id))) return false;
      }
      const draft = await api.createNote(token, { template_id: template.id, folder_id: template.target_folder_id, template_timezone_offset: new Date().getTimezoneOffset() });
      await activateFreshDraft(draft);
      setTemplateDialog(null);
      setSelectedFolderId(template.target_folder_id ?? undefined);
      setExpandedFolders((previous) => {
        const next = new Set(previous);
        let folderId = template.target_folder_id;
        const seen = new Set<string>();
        while (folderId && !seen.has(folderId)) {
          seen.add(folderId);
          next.add(folderId);
          folderId = folders.find((folder) => folder.id === folderId)?.parent_id ?? null;
        }
        return next;
      });
      return true;
    } catch (e) { handleApiError(e); return false; }
    finally { templateCreationBusy.current = false; }
  }

  function handleTemplateInsert(template: NoteTemplate): boolean {
    const note = activeNoteRef.current;
    const view = editorViewRef.current;
    if (!note || note.deleted_at || !view || composingRef.current || view.composing) return false;
    const inserted = insertTextAtCursor(view, renderTemplate(template.content, titleInputRef.current?.value ?? draftTitleRef.current));
    if (!inserted) return false;
    setTemplateDialog(null);
    window.setTimeout(() => {
      if (activeNoteIdRef.current === note.id && editorViewRef.current === view) view.focus();
    }, 0);
    return true;
  }

  const templateCreateRef = useRef(handleTemplateNote);
  templateCreateRef.current = handleTemplateNote;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (templateDialog || confirmOpen || paletteOpen || event.repeat || event.getModifierState("AltGraph")) return;
      const shortcut = templateShortcut(event);
      if (!shortcut) return;
      const template = templateSettings.templates.find((item) => item.shortcut === shortcut);
      if (!template) return;
      event.preventDefault(); event.stopPropagation();
      void templateCreateRef.current(template);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [templateSettings, templateDialog, confirmOpen, paletteOpen]);

  const templateCommands: AppCommand[] = [
    { id: "manage-templates", title: "노트 템플릿 관리", description: "", keywords: "template 템플릿 양식", run: () => setTemplateDialog(true) },
    ...templateSettings.templates.map((template) => ({
      id: `template-${template.id}`, title: `${template.name} 새 노트`,
      description: folderLinkPath(template.target_folder_id, folders) || "루트",
      shortcut: shortcutLabel(template.shortcut), keywords: `template 템플릿 ${template.name}`,
      disabled: !!template.target_folder_id && !folders.some((folder) => folder.id === template.target_folder_id),
      run: () => void handleTemplateNote(template),
    })),
    ...templateSettings.templates.map((template) => ({
      id: `insert-template-${template.id}`, title: `${template.name} 현재 노트에 삽입`,
      description: "", keywords: `template 템플릿 삽입 ${template.name}`,
      disabled: !activeNote || !!activeNote.deleted_at || !template.content,
      run: () => void handleTemplateInsert(template),
    })),
  ];

  return { handleTemplateNote, handleTemplateInsert, templateCommands };
}
