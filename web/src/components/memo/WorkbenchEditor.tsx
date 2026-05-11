// 메모 편집 영역: 저장 상태 메타 툴바 · 미디어 툴바 · 그리기 툴바 · 제목/태그 ·
// CodeMirror 본문 · 슬래시 메뉴 오버레이 · OverlayDrawingLayer.
// 상태 소유는 MemoWorkbench 가 유지하고, 이 파일은 표시 + 이벤트 위임만 한다.

import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import {
  type ChangeEvent,
  type CompositionEvent,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  IconArchive,
  IconBrush,
  IconClock,
  IconEraser,
  IconFile,
  IconHighlighter,
  IconImage,
  IconList,
  IconMic,
  IconMusic,
  IconPaperclip,
  IconRedo,
  IconSave,
  IconStar,
  IconStop,
  IconTrash,
  IconUndo,
} from "./Icons";
import {
  OverlayDrawingLayer,
  type OverlayDrawingLayerHandle,
  type OverlayDrawingTool,
} from "./OverlayDrawingLayer";
import type { Folder, NoteDetail, OverlayStroke, Tag } from "@/lib/api";
import type { SlashMenuState } from "./workbenchTypes";
import type { RightPanelKind } from "./WorkbenchRightPanel";

export type SaveState = "saved" | "saving" | "dirty";

export type SlashMenuEntry = {
  id: string;
  title: string;
  description: string;
  run: () => void;
};

export type WorkbenchEditorCardProps = {
  activeNote: NoteDetail | undefined;
  onNewNote: () => void;
  onRestoreDeletedNote: () => void | Promise<void>;

  saveState: SaveState;
  folderOptions: Folder[];
  onMoveNoteFolder: (ev: ChangeEvent<HTMLSelectElement>) => void | Promise<void>;
  onToggleFavorite: () => void | Promise<void>;
  onToggleArchive: () => void | Promise<void>;
  onManualSnapshot: () => void | Promise<void>;
  onTrashNote: () => void | Promise<void>;

  imageInputRef: RefObject<HTMLInputElement | null>;
  onPickImageFile: (file: File) => void | Promise<void>;

  isRecording: boolean;
  onToggleAudioRecording: () => void;

  rightPanel: RightPanelKind | null;
  setRightPanel: Dispatch<SetStateAction<RightPanelKind | null>>;

  drawingMode: boolean;
  setDrawingMode: Dispatch<SetStateAction<boolean>>;
  drawingTool: OverlayDrawingTool;
  setDrawingTool: Dispatch<SetStateAction<OverlayDrawingTool>>;
  drawingColor: string;
  setDrawingColor: Dispatch<SetStateAction<string>>;
  drawingWidth: number;
  setDrawingWidth: Dispatch<SetStateAction<number>>;
  overlayHandleRef: RefObject<OverlayDrawingLayerHandle | null>;
  overlayStrokes: OverlayStroke[];
  setOverlayStrokes: Dispatch<SetStateAction<OverlayStroke[]>>;
  askConfirm: (opts: {
    title: string;
    message: string;
    confirmLabel: string;
  }) => Promise<boolean>;

  titleInputRef: RefObject<HTMLInputElement | null>;
  title: string;
  /** setTitle + (조합 입력 중이 아니면) scheduleAutosave — 부모에서 composingRef 처리 */
  onTitleChange: (next: string) => void;
  onTitleCompositionStart: (ev: CompositionEvent<HTMLInputElement>) => void;
  onTitleCompositionEnd: (ev: CompositionEvent<HTMLInputElement>) => void;

  allTags: Tag[];
  onToggleTagForActive: (tag: Tag, nextOn: boolean) => void | Promise<void>;

  content: string;
  onBodyChange: (next: string) => void;
  codeMirrorExtensions: Extension[];
  onEditorMount: (view: EditorView) => void;

  slashMenu: SlashMenuState;
  filteredSlashCommands: SlashMenuEntry[];
  slashSelected: number;
  setSlashSelected: Dispatch<SetStateAction<number>>;
};

export function WorkbenchEditorCard(props: WorkbenchEditorCardProps) {
  const {
    activeNote,
    onNewNote,
    onRestoreDeletedNote,
    saveState,
    folderOptions,
    onMoveNoteFolder,
    onToggleFavorite,
    onToggleArchive,
    onManualSnapshot,
    onTrashNote,
    imageInputRef,
    onPickImageFile,
    isRecording,
    onToggleAudioRecording,
    rightPanel,
    setRightPanel,
    drawingMode,
    setDrawingMode,
    drawingTool,
    setDrawingTool,
    drawingColor,
    setDrawingColor,
    drawingWidth,
    setDrawingWidth,
    overlayHandleRef,
    overlayStrokes,
    setOverlayStrokes,
    askConfirm,
    titleInputRef,
    title,
    onTitleChange,
    onTitleCompositionStart,
    onTitleCompositionEnd,
    allTags,
    onToggleTagForActive,
    content,
    onBodyChange,
    codeMirrorExtensions,
    onEditorMount,
    slashMenu,
    filteredSlashCommands,
    slashSelected,
    setSlashSelected,
  } = props;

  if (!activeNote) {
    return (
      <section className="grid h-full place-items-center px-6 py-12 text-center">
        <div className="max-w-sm space-y-3 rounded-2xl bg-white p-8 shadow-pane ring-1 ring-ink-900/10">
          <p className="text-xs uppercase tracking-[0.3em] text-ink-900/35">시작</p>
          <p className="text-lg font-semibold text-ink-900">메모를 선택하거나 새로 만들어 보세요.</p>
          <p className="text-sm text-ink-900/60">사이드바에서 폴더·태그를 정리하면 흐름이 유지됩니다.</p>
          <button
            type="button"
            className="rounded-full bg-ink-900 px-5 py-2 text-sm font-semibold text-white"
            onClick={onNewNote}
          >
            새 노트 만들기
          </button>
        </div>
      </section>
    );
  }

  if (activeNote.deleted_at) {
    return (
      <section className="flex h-full items-center justify-center p-10 text-center text-sm text-ink-900/65">
        <div className="max-w-xs space-y-3 rounded-2xl bg-white p-8 shadow-pane ring-1 ring-ink-900/10">
          <p>이 노트는 휴지통에 있습니다. 내용은 유지되지만 편집하려면 복원해야 합니다.</p>
          <button
            type="button"
            className="rounded-full bg-emerald-600 px-5 py-2 text-xs font-semibold text-white shadow"
            onClick={() => void onRestoreDeletedNote()}
          >
            복원하고 편집
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-9 items-center gap-2 border-b border-ink-900/10 bg-[#fafaf9] px-3 text-[12px] text-ink-900/65">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            saveState === "dirty"
              ? "bg-amber-100 text-amber-800"
              : saveState === "saving"
                ? "bg-sky-100 text-sky-900"
                : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {saveState === "dirty" ? "편집 중" : saveState === "saving" ? "저장 중" : "저장됨"}
        </span>
        <select
          value={activeNote.folder_id ?? ""}
          onChange={onMoveNoteFolder}
          aria-label="폴더 배치"
          className="h-6 rounded border border-ink-900/12 bg-white/70 px-1 text-[12px]"
        >
          <option value="">루트</option>
          {folderOptions.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void onToggleFavorite()}
          title="즐겨찾기"
          aria-label="즐겨찾기 토글"
          className={`grid h-7 w-7 place-items-center rounded ${
            activeNote.is_favorite ? "bg-black/10 text-ink-900" : "hover:bg-black/5 hover:text-ink-900"
          }`}
        >
          <IconStar size={15} filled={activeNote.is_favorite} />
        </button>
        <button
          type="button"
          onClick={() => void onToggleArchive()}
          title="아카이브"
          aria-label="아카이브 토글"
          className={`grid h-7 w-7 place-items-center rounded ${
            activeNote.is_archived ? "bg-black/10 text-ink-900" : "hover:bg-black/5 hover:text-ink-900"
          }`}
        >
          <IconArchive size={15} />
        </button>
        <button
          type="button"
          onClick={() => void onManualSnapshot()}
          title="체크포인트"
          aria-label="체크포인트 저장"
          className="grid h-7 w-7 place-items-center rounded hover:bg-black/5 hover:text-ink-900"
        >
          <IconSave size={15} />
        </button>
        <button
          type="button"
          onClick={() => void onTrashNote()}
          title="휴지통으로 이동"
          aria-label="휴지통으로 이동"
          className="grid h-7 w-7 place-items-center rounded hover:bg-black/5 hover:text-ink-900"
        >
          <IconTrash size={15} />
        </button>

        <div className="ml-auto flex items-center gap-1">
          <label
            title="이미지 본문에 삽입"
            aria-label="이미지 본문에 삽입"
            className="grid h-7 w-7 cursor-pointer place-items-center rounded hover:bg-black/5 hover:text-ink-900"
          >
            <IconImage size={15} />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                ev.target.value = "";
                if (f) void onPickImageFile(f);
              }}
            />
          </label>
          <button
            type="button"
            onClick={onToggleAudioRecording}
            title={isRecording ? "녹음 종료" : "음성 녹음 시작"}
            aria-label={isRecording ? "녹음 종료" : "음성 녹음 시작"}
            className={`grid h-7 w-7 place-items-center rounded ${
              isRecording ? "bg-red-500 text-white animate-pulse" : "hover:bg-black/5 hover:text-ink-900"
            }`}
          >
            {isRecording ? <IconStop size={15} /> : <IconMic size={15} />}
          </button>
          <label
            title="오디오 파일 본문에 삽입"
            aria-label="오디오 파일 본문에 삽입"
            className="grid h-7 w-7 cursor-pointer place-items-center rounded hover:bg-black/5 hover:text-ink-900"
          >
            <IconMusic size={15} />
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                ev.target.value = "";
                if (f) void onPickImageFile(f);
              }}
            />
          </label>
          <label
            title="일반 파일 본문에 삽입"
            aria-label="일반 파일 본문에 삽입"
            className="grid h-7 w-7 cursor-pointer place-items-center rounded hover:bg-black/5 hover:text-ink-900"
          >
            <IconFile size={15} />
            <input
              type="file"
              className="hidden"
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                ev.target.value = "";
                if (f) void onPickImageFile(f);
              }}
            />
          </label>

          <span className="mx-1 h-4 w-px bg-ink-900/10" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setRightPanel(rightPanel === "files" ? null : "files")}
            title="첨부 파일"
            aria-label="첨부 파일 토글"
            className={`grid h-7 w-7 place-items-center rounded ${
              rightPanel === "files" ? "bg-black/10 text-ink-900" : "hover:bg-black/5 hover:text-ink-900"
            }`}
          >
            <IconPaperclip size={15} />
          </button>
          <button
            type="button"
            onClick={() => setRightPanel(rightPanel === "todos" ? null : "todos")}
            title="모든 할 일"
            aria-label="모든 할 일 토글"
            className={`grid h-7 w-7 place-items-center rounded ${
              rightPanel === "todos" ? "bg-black/10 text-ink-900" : "hover:bg-black/5 hover:text-ink-900"
            }`}
          >
            <IconList size={15} />
          </button>
          <button
            type="button"
            onClick={() => setRightPanel(rightPanel === "versions" ? null : "versions")}
            title="버전 히스토리"
            aria-label="버전 히스토리 토글"
            className={`grid h-7 w-7 place-items-center rounded ${
              rightPanel === "versions" ? "bg-black/10 text-ink-900" : "hover:bg-black/5 hover:text-ink-900"
            }`}
          >
            <IconClock size={15} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-ink-900/10 bg-[#fafaf9] px-3 py-1.5">
        <button
          type="button"
          onClick={() => setDrawingMode((v) => !v)}
          title={drawingMode ? "그리기 끄기" : "본문 위에 자유 그리기"}
          aria-pressed={drawingMode}
          className={`grid h-7 w-7 place-items-center rounded ${
            drawingMode ? "bg-indigo-500 text-white" : "text-ink-900/65 hover:bg-black/5 hover:text-ink-900"
          }`}
        >
          <IconBrush size={15} />
        </button>
        {drawingMode && (
          <>
            <span className="mx-1 h-4 w-px bg-ink-900/15" />
            <button
              type="button"
              onClick={() => setDrawingTool("pen")}
              title="펜"
              aria-pressed={drawingTool === "pen"}
              className={`grid h-7 w-7 place-items-center rounded ${
                drawingTool === "pen" ? "bg-black/10 text-ink-900" : "text-ink-900/65 hover:bg-black/5"
              }`}
            >
              <IconBrush size={15} />
            </button>
            <button
              type="button"
              onClick={() => setDrawingTool("highlighter")}
              title="형광펜"
              aria-pressed={drawingTool === "highlighter"}
              className={`grid h-7 w-7 place-items-center rounded ${
                drawingTool === "highlighter" ? "bg-black/10 text-ink-900" : "text-ink-900/65 hover:bg-black/5"
              }`}
            >
              <IconHighlighter size={15} />
            </button>
            <button
              type="button"
              onClick={() => setDrawingTool("eraser")}
              title="지우개(stroke 단위)"
              aria-pressed={drawingTool === "eraser"}
              className={`grid h-7 w-7 place-items-center rounded ${
                drawingTool === "eraser" ? "bg-black/10 text-ink-900" : "text-ink-900/65 hover:bg-black/5"
              }`}
            >
              <IconEraser size={15} />
            </button>
            <span className="mx-1 h-4 w-px bg-ink-900/15" />
            {["#1f2937", "#dc2626", "#2563eb", "#16a34a", "#f59e0b"].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setDrawingColor(c)}
                title={c}
                className={`h-5 w-5 rounded-full border ${
                  drawingColor === c ? "border-ink-900 ring-2 ring-indigo-300" : "border-ink-900/20"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            <span className="mx-1 h-4 w-px bg-ink-900/15" />
            <input
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={drawingWidth}
              onChange={(ev) => setDrawingWidth(Number(ev.target.value))}
              className="h-5 w-24"
              title={`굵기 ${drawingWidth}px`}
            />
            <span className="text-[11px] tabular-nums text-ink-900/55">{drawingWidth.toFixed(1)}</span>
            <span className="mx-1 h-4 w-px bg-ink-900/15" />
            <button
              type="button"
              onClick={() => overlayHandleRef.current?.undo()}
              title="되돌리기"
              className="grid h-7 w-7 place-items-center rounded text-ink-900/65 hover:bg-black/5 hover:text-ink-900"
            >
              <IconUndo size={15} />
            </button>
            <button
              type="button"
              onClick={() => overlayHandleRef.current?.redo()}
              title="다시 실행"
              className="grid h-7 w-7 place-items-center rounded text-ink-900/65 hover:bg-black/5 hover:text-ink-900"
            >
              <IconRedo size={15} />
            </button>
            <button
              type="button"
              onClick={async () => {
                if (overlayStrokes.length === 0) return;
                const ok = await askConfirm({
                  title: "그림 전체 삭제",
                  message:
                    "이 노트의 그림 레이어를 모두 지우시겠어요? 이 작업은 되돌리기로만 복구할 수 있어요.",
                  confirmLabel: "전부 지우기",
                });
                if (!ok) return;
                overlayHandleRef.current?.clear();
              }}
              title="전부 지우기"
              className="ml-1 rounded px-1.5 text-[11px] text-ink-900/55 hover:bg-black/5 hover:text-ink-900"
            >
              전부 지우기
            </button>
          </>
        )}
      </div>

      <main className="scrollbar-subtle relative flex-1 overflow-y-auto overflow-x-hidden px-6 py-6 md:px-10">
        <div className="relative">
          <input
            ref={titleInputRef}
            className="mx-auto block w-full max-w-3xl border-0 bg-transparent px-0 py-2 text-3xl font-semibold tracking-tight text-ink-900 outline-none placeholder:text-ink-900/25 focus:ring-0"
            value={title}
            onChange={(ev) => onTitleChange(ev.target.value)}
            onCompositionStart={onTitleCompositionStart}
            onCompositionEnd={onTitleCompositionEnd}
            placeholder="제목"
          />

          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-1.5 pb-4 pt-1 text-[12px] text-ink-900/55">
            {activeNote.tags.length === 0 ? (
              <span className="text-ink-900/30">태그 없음</span>
            ) : (
              activeNote.tags.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  onClick={() => void onToggleTagForActive(tag, false)}
                  title="태그 해제"
                  className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-800 hover:bg-sky-100"
                >
                  #{tag.name}
                </button>
              ))
            )}
            <details className="relative">
              <summary className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-ink-900/45 hover:bg-black/5">
                + 태그
              </summary>
              <div className="absolute left-0 z-30 mt-1 w-56 rounded-md border border-ink-900/15 bg-white p-2 shadow-lg">
                <div className="flex max-h-48 flex-wrap gap-1 overflow-auto">
                  {allTags.length === 0 ? (
                    <p className="text-[11px] text-ink-900/45">먼저 사이드바에서 태그를 만드세요.</p>
                  ) : (
                    allTags.map((tag) => {
                      const on = !!activeNote.tags.find((x) => x.id === tag.id);
                      return (
                        <button
                          type="button"
                          key={tag.id}
                          onClick={() => void onToggleTagForActive(tag, !on)}
                          className={`rounded px-1.5 py-0.5 text-[11px] ${
                            on ? "bg-ink-900 text-white" : "bg-black/5 text-ink-900/65 hover:bg-black/10"
                          }`}
                        >
                          #{tag.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </details>
          </div>

          <section className="relative mx-auto w-full max-w-3xl min-h-[62dvh] py-2">
            <CodeMirror
              value={content}
              height="auto"
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                dropCursor: true,
                searchKeymap: true,
              }}
              extensions={codeMirrorExtensions}
              placeholder="내용은 Markdown 스타일로 자유롭게 작성하세요. 자동 저장이 켜져 있습니다."
              onCreateEditor={onEditorMount}
              onChange={(value) => {
                onBodyChange(value);
              }}
              className="[&_.cm-editor]:border-0 [&_.cm-editor]:bg-transparent [&_.cm-editor]:font-inherit [&_.cm-scroller]:text-[15px] [&_.cm-scroller]:leading-6 [&_.cm-content]:min-h-[58dvh] [&_.cm-content]:px-0 [&_.cm-content]:py-1"
            />
            {slashMenu && filteredSlashCommands.length > 0 ? (
              <div
                className="fixed z-[70] w-72 overflow-hidden rounded-xl border border-ink-900/12 bg-white text-[13px] shadow-xl"
                style={{ left: slashMenu.x, top: slashMenu.y }}
              >
                <div className="border-b border-ink-900/8 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-900/40">
                  슬래시 커맨드 · ↑↓ 이동 · Enter 실행 · Esc 닫기
                </div>
                <div className="max-h-72 overflow-y-auto py-1">
                  {filteredSlashCommands.slice(0, 8).map((cmd, idx) => {
                    const selected = idx === slashSelected;
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        className={`block w-full px-3 py-2 text-left ${
                          selected ? "bg-indigo-50" : "hover:bg-black/5"
                        }`}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onMouseEnter={() => setSlashSelected(idx)}
                        onClick={() => cmd.run()}
                      >
                        <span
                          className={`block font-semibold ${
                            selected ? "text-indigo-700" : "text-ink-900"
                          }`}
                        >
                          {cmd.title}
                        </span>
                        <span className="block text-[11px] text-ink-900/45">{cmd.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>
          <OverlayDrawingLayer
            ref={overlayHandleRef}
            enabled={drawingMode}
            tool={drawingTool}
            color={drawingColor}
            width={drawingWidth}
            strokes={overlayStrokes}
            onStrokesChange={setOverlayStrokes}
          />
        </div>
      </main>
    </section>
  );
}
