export type LinkNote = { id: string; title: string; folder_id: string | null };
export type LinkFolder = { id: string; name: string; parent_id: string | null };
export type LinkCandidate = LinkNote & { path: string };

function encodePart(value: string): string {
  return value.trim().replace(/[/%\[\]|\n\r]/g, (char) => encodeURIComponent(char));
}

export function folderLinkPath(folderId: string | null, folders: LinkFolder[]): string | null {
  const parts: string[] = [];
  const seen = new Set<string>();
  let id = folderId;
  while (id) {
    if (seen.has(id)) return null;
    seen.add(id);
    const folder = folders.find((item) => item.id === id);
    if (!folder) return null;
    parts.unshift(encodePart(folder.name));
    id = folder.parent_id;
  }
  return parts.length ? `/${parts.join("/")}` : "";
}

export function buildLinkCandidates(notes: LinkNote[], folders: LinkFolder[]): LinkCandidate[] {
  return notes.flatMap((note) => {
    const parent = folderLinkPath(note.folder_id, folders);
    return parent === null ? [] : [{ ...note, path: `${parent}/${encodePart(note.title)}` }];
  });
}

function pathKey(path: string): string {
  return path.replace(/^\//, "").split("/").map((part) => {
    try { return decodeURIComponent(part).trim().toLowerCase(); }
    catch { return part.trim().toLowerCase(); }
  }).map(encodePart).join("/");
}

export function resolveLink(target: string, notes: LinkCandidate[], sourceFolder: string | null): LinkCandidate[] {
  const text = target.trim();
  if (text.includes("/")) return notes.filter((note) => pathKey(note.path) === pathKey(text));
  const matches = notes.filter((note) => note.title.trim().toLowerCase() === text.toLowerCase());
  const local = matches.filter((note) => note.folder_id === sourceFolder);
  return local.length ? local : matches;
}

export function newLinkTarget(title: string, sourceFolder: string | null, folders: LinkFolder[]): string {
  if (title.includes("/")) return title.startsWith("/") ? title : `/${title}`;
  const parent = folderLinkPath(sourceFolder, folders);
  return `${parent ?? ""}/${encodePart(title)}`;
}

export function linkCreationLocation(target: string, folders: LinkFolder[]): { title: string; folderId: string | null } | null {
  const parts = target.replace(/^\//, "").split("/");
  let title: string;
  try { title = decodeURIComponent(parts.pop() ?? "").trim(); } catch { return null; }
  if (!title) return null;
  if (!parts.length) return { title, folderId: null };
  const parent = parts.join("/");
  const matched = folders.filter((folder) => {
    const path = folderLinkPath(folder.id, folders);
    return path !== null && pathKey(path) === pathKey(parent);
  });
  return matched.length === 1 ? { title, folderId: matched[0].id } : null;
}
