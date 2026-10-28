// 백링크 패널: 이 노트를 가리키는 다른 노트의 줄과, 이 노트에서 나가는 깨진 링크.
// 이 기기에 사본을 보관하면 사본에서 바로 찾고(오프라인에서도 됨), 아니면 서버에 묻는다.
// Workbench 에서 분리.

import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import type { Folder } from "@/lib/api";
import { ApiError, api } from "@/lib/api";
import { offlineStore } from "@/lib/offlineStore";
import { parseWikilinks } from "./markdown";
import type { RightPanelKind } from "./WorkbenchRightPanel";
import type { BacklinkItem } from "./workbenchTypes";
import { buildLinkCandidates, resolveLink, type LinkCandidate } from "./wikilinkPaths";
import type { EditorSession } from "./useEditorSession";

type Options = {
  token: string;
  folders: Folder[];
  /** 서버에서 받아 둔 전체 노트(일반+아카이브)의 링크 후보. 온라인일 때 깨진 링크를 여기서 찾는다. */
  linkCandidatesRef: MutableRefObject<LinkCandidate[]>;
  /** 백링크 패널이 열려 있을 때만 찾는다. */
  rightPanel: RightPanelKind | null;
  /** 노트·제목이 바뀌면 다시 찾고, 깨진 링크는 아직 저장 전인 지금 본문(draftContentRef)에서 찾는다. */
  session: EditorSession;
  /** 기기 사본이 바뀔 때마다 +1. 사본에서 계산할 때 다시 찾는 신호. */
  cacheTick: number;
  handleApiError: (e: unknown) => void;
};

export function useBacklinks(options: Options) {
  const { token, folders, linkCandidatesRef, rightPanel, session, cacheTick, handleApiError } = options;
  const { activeNote, activeNoteRef, draftContentRef } = session;
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [brokenLinks, setBrokenLinks] = useState<string[]>([]);
  const [backlinksLoading, setBacklinksLoading] = useState(false);

  /** 지금 본문에서 나가는 링크 중, 주어진 제목들 어디에도 없는 것. */
  function findBrokenLinks(candidates: LinkCandidate[]): string[] {
    const seen = new Set<string>();
    const broken: string[] = [];
    for (const line of draftContentRef.current.split("\n")) {
      for (const link of parseWikilinks(line)) {
        const t = link.title.trim();
        const key = t.toLowerCase();
        if (!t || resolveLink(t, candidates, activeNoteRef.current?.folder_id ?? null).length === 1 || seen.has(key)) continue;
        seen.add(key);
        broken.push(t);
      }
    }
    return broken;
  }

  const refreshBacklinks = useCallback(async () => {
    const note = activeNoteRef.current;
    if (!note) return;
    setBacklinksLoading(true);
    try {
      if (!offlineStore.isActive()) {
        const rows = await api.listBacklinks(token, note.id);
        setBacklinks(
          rows.map((r) => ({
            id: `${r.note_id}:${r.line_index}`,
            noteId: r.note_id,
            noteTitle: r.note_title,
            lineIndex: r.line_index,
            text: r.text,
          })),
        );
        setBrokenLinks(findBrokenLinks(linkCandidatesRef.current));
        return;
      }
      const all = (await offlineStore.listNotes()).filter((n) => !n.deleted_at);
      const candidates = buildLinkCandidates(all, folders);
      setBacklinks(
        all
              .filter((n) => n.id !== note.id)
              .flatMap((n) =>
                n.content.split("\n").flatMap((line, index) =>
                  parseWikilinks(line).some((link) => {
                    const matches = resolveLink(link.title, candidates, n.folder_id);
                    return matches.length === 1 && matches[0].id === note.id;
                  })
                    ? [
                        {
                          id: `${n.id}:${index}`,
                          noteId: n.id,
                          noteTitle: n.title || "무제 노트",
                          lineIndex: index,
                          text: line.trim(),
                        },
                      ]
                    : [],
                ),
              )
              .sort((a, b) => a.noteTitle.localeCompare(b.noteTitle, "ko") || a.lineIndex - b.lineIndex),
      );
      setBrokenLinks(findBrokenLinks(candidates));
    } catch (e) {
      // 오프라인인데 사본도 없으면 찾을 방법이 없다.
      if (e instanceof ApiError) handleApiError(e);
      setBacklinks([]);
      setBrokenLinks([]);
    } finally {
      setBacklinksLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleApiError, token, folders]);

  useEffect(() => {
    if (rightPanel !== "backlinks") return;
    void refreshBacklinks();
  }, [rightPanel, activeNote?.id, activeNote?.title, cacheTick, refreshBacklinks]);

  return { backlinks, brokenLinks, backlinksLoading, refreshBacklinks };
}
