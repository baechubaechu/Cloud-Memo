/**
 * 기기 로컬 저장소 (IndexedDB). 원본은 항상 서버이고, 여기는 오프라인용 사본이다.
 *
 *  - notes:  서버에서 내려받은 노트 사본 (마지막으로 확인한 서버 상태).
 *  - drafts: 서버에 아직 닿지 못한 편집. 저장 요청 직전에 쓰고, 서버가 받으면 지운다.
 *            "마지막으로 서버와 맞췄던 기준점" 이 같이 들어 있어, 그 사이 다른 기기가
 *            고쳤더라도 서버가 병합할 수 있다.
 *  - seqs:   노트 id → change_seq. 사본이 낡았는지 비교할 때 본문까지 읽지 않으려고 따로 둔다.
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
const DB_VERSION = 3;
const DRAFTS = "drafts";
const NOTES = "notes";
const KV = "kv";
const SEQS = "seqs";

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
        if (!db.objectStoreNames.contains(SEQS)) db.createObjectStore(SEQS);
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
  const db = await openDb();
  if (!db) return;
  // 사본과 버전 번호를 한 트랜잭션으로 쓴다 (둘이 어긋나면 낡은 사본을 최신으로 착각한다).
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([NOTES, SEQS], "readwrite");
      tx.objectStore(NOTES).put(note);
      tx.objectStore(SEQS).put(note.change_seq, note.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function getNote(id: string): Promise<NoteDetail | undefined> {
  return run<NoteDetail | undefined>(NOTES, "readonly", (s) => s.get(id), undefined);
}

async function deleteNote(id: string): Promise<void> {
  await run<undefined>(NOTES, "readwrite", (s) => s.delete(id), undefined);
  await run<undefined>(SEQS, "readwrite", (s) => s.delete(id), undefined);
}

/** 사본마다의 change_seq (본문은 읽지 않는다). */
async function noteSeqs(): Promise<Map<string, number>> {
  const keys = await run<IDBValidKey[]>(SEQS, "readonly", (s) => s.getAllKeys(), []);
  const values = await run<number[]>(SEQS, "readonly", (s) => s.getAll(), []);
  const out = new Map<string, number>();
  keys.forEach((k, i) => out.set(String(k), values[i]));
  return out;
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
  await run<undefined>(SEQS, "readwrite", (s) => s.clear(), undefined);
  await run<undefined>(KV, "readwrite", (s) => s.clear(), undefined);
}

/**
 * 브라우저가 디스크가 부족할 때 이 사이트의 저장소를 지우지 않도록 요청한다.
 * 거절돼도 동작에는 문제없다 (원본은 서버에 있다).
 */
async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
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
  noteSeqs,
  requestPersistence,
  setKv,
  getKv,
  clearCache,
};
