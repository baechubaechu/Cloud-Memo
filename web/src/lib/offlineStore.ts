/**
 * 서버에 아직 닿지 못한 편집을 기기에 보관한다 (IndexedDB).
 *
 * 저장 요청을 보내기 직전에 초안을 여기에 쓰고, 서버가 받으면 지운다. 그래서
 * 연결이 끊긴 채 탭을 닫아도 글이 남고, 다음에 연결되면 그대로 서버에 올린다.
 * 초안에는 "마지막으로 서버와 맞췄던 기준점" 이 같이 들어 있어, 그 사이 다른
 * 기기가 고쳤더라도 서버가 병합할 수 있다.
 *
 * IndexedDB 를 못 쓰는 환경(사생활 보호 모드 등)에서는 조용히 아무 일도 하지 않는다.
 */

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
const STORE = "drafts";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: "noteId" });
        }
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
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
  fallback: T,
): Promise<T> {
  const db = await openDb();
  if (!db) return fallback;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(fallback);
    } catch {
      resolve(fallback);
    }
  });
}

async function putDraft(draft: PendingDraft): Promise<void> {
  await run<IDBValidKey>("readwrite", (s) => s.put(draft), "");
}

async function deleteDraft(noteId: string): Promise<void> {
  await run<undefined>("readwrite", (s) => s.delete(noteId), undefined);
}

async function listDrafts(): Promise<PendingDraft[]> {
  return run<PendingDraft[]>("readonly", (s) => s.getAll(), []);
}

export const offlineStore = { putDraft, deleteDraft, listDrafts };
