/**
 * 기기 로컬 저장소 (IndexedDB). 원본은 항상 서버이고, 여기는 오프라인용 사본이다.
 *
 *  - notes:  서버에서 내려받은 노트 사본 (마지막으로 확인한 서버 상태).
 *  - drafts: 서버에 아직 닿지 못한 편집. 저장 요청 직전에 쓰고, 서버가 받으면 지운다.
 *            "마지막으로 서버와 맞췄던 기준점" 이 같이 들어 있어, 그 사이 다른 기기가
 *            고쳤더라도 서버가 병합할 수 있다.
 *  - kv:     폴더·태그 목록, 사본을 어디까지 받았는지(cacheSeq) 같은 작은 값.
 *
 * IndexedDB 를 못 쓰는 환경(사생활 보호 모드 등)에서는 조용히 아무 일도 하지 않는다.
 */

import type { NoteDetail } from "@/lib/api";

export type PendingDraft = {
  noteId: string;
  title: string;
  content: string;
  baseRevision: number;
  baseTitle: string;
  baseContent: string;
  updatedAt: number;
};

const DB_NAME = "cloud-memo-offline";
const DB_VERSION = 2;
const DRAFTS = "drafts";
const NOTES = "notes";
const KV = "kv";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: "noteId" });
        if (!db.objectStoreNames.contains(NOTES)) db.createObjectStore(NOTES, { keyPath: "id" });
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
  fallback: T,
): Promise<T> {
  const db = await openDb();
  if (!db) return fallback;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(storeName, mode).objectStore(storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(fallback);
    } catch {
      resolve(fallback);
    }
  });
}

// ---------- drafts ----------

async function putDraft(draft: PendingDraft): Promise<void> {
  await run<IDBValidKey>(DRAFTS, "readwrite", (s) => s.put(draft), "");
}

async function getDraft(noteId: string): Promise<PendingDraft | undefined> {
  return run<PendingDraft | undefined>(DRAFTS, "readonly", (s) => s.get(noteId), undefined);
}

async function deleteDraft(noteId: string): Promise<void> {
  await run<undefined>(DRAFTS, "readwrite", (s) => s.delete(noteId), undefined);
}

async function listDrafts(): Promise<PendingDraft[]> {
  return run<PendingDraft[]>(DRAFTS, "readonly", (s) => s.getAll(), []);
}

// ---------- 노트 사본 ----------

async function putNote(note: NoteDetail): Promise<void> {
  await run<IDBValidKey>(NOTES, "readwrite", (s) => s.put(note), "");
}

async function getNote(id: string): Promise<NoteDetail | undefined> {
  return run<NoteDetail | undefined>(NOTES, "readonly", (s) => s.get(id), undefined);
}

async function deleteNote(id: string): Promise<void> {
  await run<undefined>(NOTES, "readwrite", (s) => s.delete(id), undefined);
}

async function listNotes(): Promise<NoteDetail[]> {
  return run<NoteDetail[]>(NOTES, "readonly", (s) => s.getAll(), []);
}

// ---------- kv ----------

async function setKv(key: string, value: unknown): Promise<void> {
  await run<IDBValidKey>(KV, "readwrite", (s) => s.put(value, key), "");
}

async function getKv<T>(key: string): Promise<T | undefined> {
  return run<T | undefined>(KV, "readonly", (s) => s.get(key), undefined);
}

/**
 * 로그아웃 시 내려받은 사본을 지운다 (잠금 화면 뒤에 노트가 남지 않게).
 * 서버에 못 보낸 초안은 사용자의 글이므로 남겨 둔다.
 */
async function clearCache(): Promise<void> {
  await run<undefined>(NOTES, "readwrite", (s) => s.clear(), undefined);
  await run<undefined>(KV, "readwrite", (s) => s.clear(), undefined);
}

export const offlineStore = {
  putDraft,
  getDraft,
  deleteDraft,
  listDrafts,
  putNote,
  getNote,
  deleteNote,
  listNotes,
  setKv,
  getKv,
  clearCache,
};
