const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:8000";

export type Folder = {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type Tag = {
  id: string;
  name: string;
  created_at: string;
  deleted_at?: string | null;
};

export type Attachment = {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  kind: "image" | "audio" | "canvas" | "attachment";
  has_thumbnail: boolean;
  created_at: string;
  deleted_at?: string | null;
};

export type NoteListItem = {
  id: string;
  title: string;
  folder_id: string | null;
  is_favorite: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  tags: Tag[];
};

export type NoteDetail = {
  id: string;
  title: string;
  content: string;
  folder_id: string | null;
  note_type: string;
  is_favorite: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  tags: Tag[];
  attachments: Attachment[];
};

export type NoteVersion = {
  id: string;
  version_index: number;
  title: string;
  content: string;
  reason: "manual" | "before_delete" | "before_ai_edit" | "restore" | "periodic_autosave";
  created_at: string;
};

export type StorageUsage = {
  upload_root: string;
  total_bytes: number;
  by_kind: Record<string, number>;
  attachments_count: number;
};

export type AiJob = {
  id: string;
  job_type: string;
  target_note_id: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  worker_type: string | null;
  input_payload: Record<string, unknown>;
  result_payload: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type ListNotesQuery = {
  folderId?: string;
  tagId?: string;
  trash?: boolean;
  archived?: boolean;
  favorite?: boolean;
  q?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: unknown,
  ) {
    super(message);
  }
}

function authHeader(token?: string): HeadersInit {
  const headers: HeadersInit = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseJson(resp: Response) {
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchJson(path: string, init: RequestInit = {}, token?: string) {
  const resp = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...authHeader(token), ...(init.headers || {}) },
  });
  const data = await parseJson(resp);
  if (!resp.ok) throw new ApiError(String(data?.detail || resp.statusText), resp.status, data);
  return data;
}

async function login(password: string) {
  // 단일 비밀번호 잠금 모드: username 필드는 서버 호환용 더미값.
  const body = new URLSearchParams({ username: "local", password, grant_type: "password" });
  return fetchJson("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  }) as Promise<{ access_token: string }>;
}

async function logout(token: string) {
  return fetchJson("/api/auth/logout", { method: "POST" }, token) as Promise<{ ok: boolean }>;
}

async function me(token: string) {
  return fetchJson("/api/auth/me", {}, token) as Promise<{ id: string; email: string }>;
}

async function listFolders(token: string, trash?: boolean) {
  const qs = trash ? "?trash=true" : "";
  return fetchJson(`/api/folders${qs}`, {}, token) as Promise<Folder[]>;
}

async function createFolder(token: string, name: string, parent_id?: string | null) {
  return fetchJson(
    "/api/folders",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, parent_id }) },
    token,
  ) as Promise<Folder>;
}

async function patchFolder(
  token: string,
  id: string,
  body: Partial<{ name: string; parent_id: string | null; sort_order: number }>,
) {
  return fetchJson(
    `/api/folders/${id}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    token,
  ) as Promise<Folder>;
}

async function deleteFolder(token: string, id: string) {
  return fetchJson(`/api/folders/${id}`, { method: "DELETE" }, token) as Promise<Folder>;
}

async function listTags(token: string, trash?: boolean) {
  const qs = trash ? "?trash=true" : "";
  return fetchJson(`/api/tags${qs}`, {}, token) as Promise<Tag[]>;
}

async function createTag(token: string, name: string) {
  return fetchJson(
    "/api/tags",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) },
    token,
  ) as Promise<Tag>;
}

async function listNotes(token: string, params: ListNotesQuery = {}) {
  const sp = new URLSearchParams();
  if (params.folderId) sp.set("folder_id", params.folderId);
  if (params.tagId) sp.set("tag_id", params.tagId);
  if (params.trash) sp.set("trash", "true");
  if (params.favorite) sp.set("favorite", "true");
  if (params.archived !== undefined) sp.set("archived", params.archived ? "true" : "false");
  if (params.q) sp.set("q", params.q);
  const qs = sp.toString() ? `?${sp}` : "";
  return fetchJson(`/api/notes${qs}`, {}, token) as Promise<NoteListItem[]>;
}

async function searchNotes(token: string, q: string, opts: { trash?: boolean; archived?: boolean } = {}) {
  const sp = new URLSearchParams({ q });
  if (opts.trash) sp.set("trash", "true");
  if (opts.archived !== undefined) sp.set("archived", opts.archived ? "true" : "false");
  return fetchJson(`/api/search?${sp}`, {}, token) as Promise<NoteListItem[]>;
}

async function createNote(
  token: string,
  payload: { title?: string; content?: string; folder_id?: string | null; tag_ids?: string[] },
) {
  return fetchJson(
    "/api/notes",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    token,
  ) as Promise<NoteDetail>;
}

async function getNote(token: string, id: string) {
  return fetchJson(`/api/notes/${id}`, {}, token) as Promise<NoteDetail>;
}

async function patchNote(
  token: string,
  id: string,
  body: Partial<{
    title: string;
    content: string;
    folder_id: string | null;
    tag_ids: string[];
    is_favorite: boolean;
    is_archived: boolean;
    force_snapshot: boolean;
  }>,
) {
  return fetchJson(
    `/api/notes/${id}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    token,
  ) as Promise<NoteDetail>;
}

async function trashNote(token: string, id: string) {
  return fetchJson(`/api/notes/${id}`, { method: "DELETE" }, token) as Promise<NoteDetail>;
}

async function restoreNote(token: string, id: string) {
  return fetchJson(`/api/notes/${id}/restore`, { method: "POST" }, token) as Promise<NoteDetail>;
}

async function listVersions(token: string, id: string) {
  return fetchJson(`/api/notes/${id}/versions`, {}, token) as Promise<NoteVersion[]>;
}

async function snapshotNote(token: string, id: string) {
  return fetchJson(`/api/notes/${id}/versions`, { method: "POST" }, token) as Promise<NoteVersion>;
}

async function restoreVersion(token: string, id: string, versionId: string) {
  return fetchJson(`/api/notes/${id}/restore-version/${versionId}`, { method: "POST" }, token) as Promise<NoteDetail>;
}

async function setNoteTags(token: string, id: string, tag_ids: string[]) {
  return fetchJson(
    `/api/notes/${id}/tags`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag_ids }) },
    token,
  ) as Promise<NoteDetail>;
}

async function uploadAttachment(token: string, noteId: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const resp = await fetch(`${API_URL}/api/notes/${noteId}/attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    body: fd,
  });
  const data = await parseJson(resp);
  if (!resp.ok) throw new ApiError(String(data?.detail || resp.statusText), resp.status, data);
  return data as { id: string; original_filename: string; kind: string; has_thumbnail: boolean };
}

async function trashAttachment(token: string, attachmentId: string) {
  return fetchJson(`/api/attachments/${attachmentId}`, { method: "DELETE" }, token) as Promise<{ ok: boolean }>;
}

function attachmentUrl(id: string) {
  return `${API_URL}/api/attachments/${id}/download`;
}

function attachmentThumbnailUrl(id: string) {
  return `${API_URL}/api/attachments/${id}/thumbnail`;
}

async function storageUsage(token: string) {
  return fetchJson("/api/storage/usage", {}, token) as Promise<StorageUsage>;
}

async function listAiJobs(token: string) {
  return fetchJson("/api/ai-jobs", {}, token) as Promise<AiJob[]>;
}

async function createAiJob(
  token: string,
  body: { job_type: string; target_note_id?: string; worker_type?: string; input_payload?: Record<string, unknown> },
) {
  return fetchJson(
    "/api/ai-jobs",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    token,
  ) as Promise<AiJob>;
}

async function downloadMarkdownExport(token: string) {
  const resp = await fetch(`${API_URL}/api/export/markdown`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new ApiError("export failed", resp.status);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cloud-memo-export.zip";
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  API_URL,
  login,
  logout,
  me,
  listFolders,
  createFolder,
  patchFolder,
  deleteFolder,
  listTags,
  createTag,
  listNotes,
  searchNotes,
  createNote,
  getNote,
  patchNote,
  trashNote,
  restoreNote,
  listVersions,
  snapshotNote,
  restoreVersion,
  setNoteTags,
  uploadAttachment,
  trashAttachment,
  attachmentUrl,
  attachmentThumbnailUrl,
  storageUsage,
  listAiJobs,
  createAiJob,
  downloadMarkdownExport,
};
