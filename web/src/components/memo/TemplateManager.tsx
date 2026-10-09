"use client";

import { useEffect, useRef, useState } from "react";
import { api, type Folder, type NoteTemplate, type TemplateBody, type TemplateSettings } from "@/lib/api";
import { IconFilePlus, IconPlus, IconSave, IconTrash, IconX } from "./Icons";
import { folderLinkPath } from "./wikilinkPaths";
import { shortcutLabel, templateShortcut } from "./templateShortcuts";

const emptyDraft: TemplateBody = { name: "", title: "", content: "", shortcut: null, target_folder_id: null };
const fieldClass = "w-full min-w-0 rounded border border-ink-900/20 bg-white px-2.5 py-2 text-sm outline-none focus:border-emerald-600";

export function TemplateManager({ token, settings, folders, onSettings, onClose, onCreate, onInsert, canInsert, confirm, confirmationOpen }: {
  token: string;
  settings: TemplateSettings;
  folders: Folder[];
  onSettings: (settings: TemplateSettings) => void;
  onClose: () => void;
  onCreate: (template: NoteTemplate) => Promise<boolean>;
  onInsert: (template: NoteTemplate) => boolean;
  canInsert: boolean;
  confirm: (message: string) => Promise<boolean>;
  confirmationOpen: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(settings.templates[0]?.id ?? null);
  const [draft, setDraft] = useState<TemplateBody>(settings.templates[0] ?? emptyDraft);
  const [savedDraft, setSavedDraft] = useState<TemplateBody>(settings.templates[0] ?? emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const closeRef = useRef<() => void>(() => {});
  const confirmationRef = useRef(confirmationOpen);
  confirmationRef.current = confirmationOpen;
  closeRef.current = () => { if (!busy) void (async () => { if (!dirty || await confirm("저장하지 않은 템플릿 변경을 버리시겠어요?")) onClose(); })(); };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (confirmationRef.current) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? []);
      const first = elements[0], last = elements[elements.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); previous?.focus(); };
  }, []);

  async function choose(template: NoteTemplate | null) {
    if (dirty && !(await confirm("저장하지 않은 템플릿 변경을 버리시겠어요?"))) return;
    setSelected(template?.id ?? null);
    setDraft(template ?? { ...emptyDraft });
    setSavedDraft(template ?? { ...emptyDraft });
    setError(null); setNotice("");
  }
  async function save() {
    setBusy(true); setError(null); setNotice("");
    try {
      const result = await api.saveTemplate(token, selected, draft);
      const saved = selected ? result.templates.find((t) => t.id === selected) : result.templates.find((t) => !settings.templates.some((old) => old.id === t.id));
      onSettings(result);
      if (saved) { setSelected(saved.id); setDraft(saved); setSavedDraft(saved); }
      setNotice("저장되었습니다.");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!selected || !(await confirm("이 템플릿을 삭제하시겠어요? 단축키도 해제됩니다. 기존 노트는 유지됩니다."))) return;
    setBusy(true); setError(null);
    try {
      onSettings(await api.deleteTemplate(token, selected));
      setSelected(null); setDraft({ ...emptyDraft }); setSavedDraft({ ...emptyDraft }); setNotice("삭제되었습니다.");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const locations = [{ id: "root", name: "최상위" }, ...folders.map((folder) => ({ id: folder.id, name: folderLinkPath(folder.id, folders) ?? folder.name }))].sort((a, b) => a.id === "root" ? -1 : b.id === "root" ? 1 : a.name.localeCompare(b.name, "ko"));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/25 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="template-dialog-title" inert={confirmationOpen} tabIndex={-1} className="flex max-h-[90dvh] w-full max-w-[900px] flex-col overflow-hidden rounded-md border border-ink-900/15 bg-white text-ink-900 shadow-xl outline-none">
        <header className="flex items-center justify-between border-b border-ink-900/10 px-4 py-3">
          <h2 id="template-dialog-title" className="text-base font-semibold">노트 템플릿</h2>
          <button aria-label="템플릿 창 닫기" title="닫기" disabled={busy} onClick={() => closeRef.current()} className="grid h-8 w-8 place-items-center rounded hover:bg-black/5"><IconX /></button>
        </header>
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto sm:grid-cols-[210px_minmax(0,1fr)]">
            <aside className="border-b border-ink-900/10 p-3 sm:border-b-0 sm:border-r">
              <button disabled={busy} onClick={() => void choose(null)} className="mb-2 flex items-center gap-2 px-2 py-2 text-sm font-medium"><IconPlus />새 템플릿</button>
              <div className="max-h-36 overflow-y-auto sm:max-h-[55dvh]">
                {settings.templates.map((template) => <button key={template.id} disabled={busy} onClick={() => void choose(template)} className={`block w-full break-words rounded px-2 py-2 text-left text-sm ${selected === template.id ? "bg-emerald-50 text-emerald-900" : "hover:bg-black/5"}`}>{template.name}</button>)}
              </div>
            </aside>
            <form className="min-w-0 space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium">이름<input autoComplete="off" required maxLength={128} disabled={busy} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={`${fieldClass} mt-1`} /></label>
                <label className="block text-xs font-medium">기본 제목<input maxLength={512} disabled={busy} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="무제 노트" className={`${fieldClass} mt-1`} /></label>
              </div>
              <label className="block text-xs font-medium">Markdown 본문<textarea ref={bodyRef} disabled={busy} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} className={`${fieldClass} mt-1 min-h-44 resize-y leading-6 sm:min-h-60`} /></label>
              <label className="flex items-center gap-2 text-xs font-medium">본문 변수
                <select aria-label="본문 변수 삽입" disabled={busy} value="" className={`${fieldClass} max-w-52`} onChange={(event) => {
                  const token = event.target.value;
                  if (!token) return;
                  const body = bodyRef.current;
                  const from = body?.selectionStart ?? draft.content.length;
                  const to = body?.selectionEnd ?? from;
                  setDraft({ ...draft, content: draft.content.slice(0, from) + token + draft.content.slice(to) });
                  window.requestAnimationFrame(() => { body?.focus(); body?.setSelectionRange(from + token.length, from + token.length); });
                }}>
                  <option value="">변수 선택</option>
                  <option value="{{date}}">날짜 · YYYY-MM-DD</option>
                  <option value="{{time}}">시간 · HH:mm</option>
                  <option value="{{title}}">노트 제목</option>
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium">생성 단축키
                  <div className="mt-1 flex gap-1">
                    <input readOnly disabled={busy} aria-label="생성 단축키" title="Ctrl/Cmd + Alt + 영문자 또는 숫자 (Shift 추가 가능)" value={shortcutLabel(draft.shortcut)} placeholder="단축키 없음" onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing || event.nativeEvent.getModifierState("AltGraph")) return;
                      if (event.key === "Backspace" || event.key === "Delete") { event.preventDefault(); setDraft({ ...draft, shortcut: null }); return; }
                      const shortcut = templateShortcut(event.nativeEvent);
                      if (shortcut) { event.preventDefault(); event.stopPropagation(); setDraft({ ...draft, shortcut }); }
                    }} className={fieldClass} />
                    <button type="button" disabled={busy} title="단축키 해제" aria-label="단축키 해제" onClick={() => setDraft({ ...draft, shortcut: null })} className="grid w-8 shrink-0 place-items-center rounded hover:bg-black/5"><IconX size={14} /></button>
                  </div>
                </label>
                <label className="block text-xs font-medium">생성 대상 폴더<select disabled={busy} value={draft.target_folder_id ?? "root"} onChange={(event) => setDraft({ ...draft, target_folder_id: event.target.value === "root" ? null : event.target.value })} className={`${fieldClass} mt-1`}>
                  {draft.target_folder_id && !folders.some((f) => f.id === draft.target_folder_id) ? <option value={draft.target_folder_id}>삭제된 폴더</option> : null}
                  {locations.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select></label>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-ink-900/10 pt-3">
                <button disabled={busy || !draft.name.trim()} type="submit" className="flex items-center gap-2 rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-40"><IconSave />저장</button>
                <button type="button" disabled={busy || !selected || dirty || (!!draft.target_folder_id && !folders.some((folder) => folder.id === draft.target_folder_id))} onClick={async () => {
                  const template = settings.templates.find((t) => t.id === selected);
                  if (!template) return;
                  setBusy(true); setError(null);
                  try { if (!(await onCreate(template))) setError("노트를 만들지 못했습니다. 연결과 대상 폴더를 확인해 주세요."); }
                  finally { setBusy(false); }
                }} className="flex items-center gap-2 rounded border border-ink-900/20 px-3 py-2 text-sm disabled:opacity-40"><IconFilePlus />새 노트 만들기</button>
                <button type="button" disabled={busy || !selected || dirty || !canInsert || !draft.content} onClick={() => {
                  const template = settings.templates.find((t) => t.id === selected);
                  if (template && !onInsert(template)) setError("본문을 편집할 수 있는 노트를 선택해 주세요.");
                }} className="flex items-center gap-2 rounded border border-ink-900/20 px-3 py-2 text-sm disabled:opacity-40"><IconPlus />현재 노트에 삽입</button>
                <button type="button" disabled={busy || !selected} title="템플릿 삭제" aria-label="템플릿 삭제" onClick={() => void remove()} className="ml-auto grid h-9 w-9 place-items-center rounded text-red-700 hover:bg-red-50 disabled:opacity-30"><IconTrash /></button>
              </div>
            </form>
          </div>
        {error || notice ? <div role={error ? "alert" : "status"} className={`border-t px-4 py-2 text-sm ${error ? "text-red-700" : "text-emerald-800"}`}>{error || notice}</div> : null}
      </div>
    </div>
  );
}
