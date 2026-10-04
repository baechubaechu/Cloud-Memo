/**
 * 기기 보관소 (IndexedDB). 원본은 항상 서버이고, 여기는 오프라인용 사본이다.
 *
 * 프라이버시 원칙
 *  - 기본은 꺼짐. 로그인할 때 "이 기기에 노트 보관" 을 켠 기기에서만 무언가를 남긴다.
 *    꺼진 기기에서는 이 모듈의 모든 동작이 아무 일도 하지 않는다 (남의 PC 에 노트가 남지 않는다).
 *  - 남기는 것은 전부 암호화한다 (AES-GCM 256). 키는 비밀번호에서 만들고(PBKDF2)
 *    **메모리에만** 둔다. 그래서 페이지를 새로 열면 비밀번호로 다시 잠금을 풀어야 하고,
 *    기기의 브라우저 폴더를 통째로 가져가도 비밀번호 없이는 읽을 수 없다.
 *  - 데이터는 이 기기 밖으로 나가지 않는다. 오가는 곳은 사용자의 서버뿐이다.
 *
 * 저장소
 *  - notes:  서버에서 내려받은 노트 사본 (암호화).
 *  - drafts: 서버에 아직 닿지 못한 편집과 그 기준점 (암호화).
 *  - kv:     폴더·태그 목록, 사본을 어디까지 받았는지(cacheSeq) (암호화).
 *  - seqs:   노트 id → change_seq. 사본이 낡았는지 비교용 (내용 없음, 평문).
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

type Sealed = { iv: Uint8Array; data: ArrayBuffer };

const DB_NAME = "cloud-memo-offline";
// v4: 암호화 도입. 올리면서 이전(평문) 저장소를 모두 지운다.
const DB_VERSION = 4;
const DRAFTS = "drafts";
const NOTES = "notes";
const KV = "kv";
const SEQS = "seqs";

const PREF_KEY = "cloud_memo_keep_on_device";
const SALT_KEY = "cloud_memo_vault_salt";
const CHECK_KEY = "cloud_memo_vault_check";
const CHECK_TEXT = "cloud-memo-vault";
const PBKDF2_ITERATIONS = 600_000;

let vaultKey: CryptoKey | null = null;
let dbPromise: Promise<IDBDatabase | null> | null = null;

// ---------- 켜기/끄기 · 잠금 ----------

/** 이 브라우저에서 암호화 보관이 가능한가 (HTTPS 또는 localhost 에서만 WebCrypto 가 열린다). */
function isSupported(): boolean {
  return typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && !!crypto.subtle;
}

function keepOnDevice(): boolean {
  try {
    return window.localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function isUnlocked(): boolean {
  return vaultKey !== null;
}

/** 보관이 켜져 있고 잠금도 풀려 있어 실제로 읽고 쓸 수 있는 상태. */
function isActive(): boolean {
  return vaultKey !== null && keepOnDevice();
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plain);
  return { iv, data };
}

async function unseal<T>(key: CryptoKey, sealed: Sealed | undefined): Promise<T | undefined> {
  if (!sealed || !sealed.iv || !sealed.data) return undefined;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv as BufferSource }, key, sealed.data);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return undefined;
  }
}

/**
 * 비밀번호로 보관소 잠금을 푼다.
 * - `serverVerified`: 방금 서버가 이 비밀번호를 확인해 줬는가. 그런데도 기존 보관소가
 *   안 열리면 비밀번호가 바뀐 것이므로, 옛 보관소를 지우고 새로 만든다.
 * - 서버 확인 없이(오프라인) 풀 때 안 열리면 "wrong" 을 돌려준다.
 */
async function unlock(password: string, serverVerified: boolean): Promise<"ok" | "wrong" | "unsupported"> {
  if (!isSupported()) return "unsupported";
  try {
    const saltText = window.localStorage.getItem(SALT_KEY);
    const checkText = window.localStorage.getItem(CHECK_KEY);
    if (saltText && checkText) {
      const key = await deriveKey(password, unb64(saltText));
      const parsed = JSON.parse(checkText) as { iv: string; data: string };
      const got = await unseal<string>(key, {
        iv: unb64(parsed.iv),
        data: unb64(parsed.data).buffer as ArrayBuffer,
      });
      if (got === CHECK_TEXT) {
        vaultKey = key;
        return "ok";
      }
      if (!serverVerified) return "wrong";
      await wipeAll();
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    const check = await seal(key, CHECK_TEXT);
    window.localStorage.setItem(SALT_KEY, b64(salt));
    window.localStorage.setItem(CHECK_KEY, JSON.stringify({ iv: b64(check.iv), data: b64(check.data) }));
    vaultKey = key;
    return "ok";
  } catch {
    return "unsupported";
  }
}

/** 이 기기에 보관할지 설정한다. 끄면 남아 있던 것을 전부 지운다. */
async function setKeepOnDevice(keep: boolean): Promise<void> {
  try {
    if (keep) {
      window.localStorage.setItem(PREF_KEY, "1");
    } else {
      window.localStorage.removeItem(PREF_KEY);
      await wipeAll();
    }
  } catch {
    /* noop */
  }
}

/** 사본·초안·키 재료를 이 기기에서 전부 지운다 (로그아웃, 보관 끄기). */
async function wipeAll(): Promise<void> {
  vaultKey = null;
  try {
    window.localStorage.removeItem(SALT_KEY);
    window.localStorage.removeItem(CHECK_KEY);
  } catch {
    /* noop */
  }
  const db = dbPromise ? await dbPromise : null;
  db?.close();
  dbPromise = null;
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * 보관이 꺼진 기기에 예전에 남은 것이 있으면 지운다 (암호화 이전 버전이 남긴 평문 사본 포함).
 * 앱이 뜰 때마다 불러도 된다.
 */
async function purgeIfDisabled(): Promise<void> {
  if (keepOnDevice()) return;
  await wipeAll();
}

// ---------- IndexedDB ----------

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
        // 이전 버전은 평문이었다. 남기지 않고 새로 만든다.
        for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
        db.createObjectStore(DRAFTS);
        db.createObjectStore(NOTES);
        db.createObjectStore(KV);
        db.createObjectStore(SEQS);
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
  if (!isActive()) return fallback;
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

async function putSealed(storeName: string, key: string, value: unknown): Promise<void> {
  const k = vaultKey;
  if (!k || !isActive()) return;
  const sealed = await seal(k, value);
  await run<IDBValidKey>(storeName, "readwrite", (s) => s.put(sealed, key), "");
}

async function getSealed<T>(storeName: string, key: string): Promise<T | undefined> {
  const k = vaultKey;
  if (!k) return undefined;
  const sealed = await run<Sealed | undefined>(storeName, "readonly", (s) => s.get(key), undefined);
  return unseal<T>(k, sealed);
}

async function getAllSealed<T>(storeName: string): Promise<T[]> {
  const k = vaultKey;
  if (!k) return [];
  const rows = await run<Sealed[]>(storeName, "readonly", (s) => s.getAll(), []);
  const out: T[] = [];
  for (const row of rows) {
    const value = await unseal<T>(k, row);
    if (value !== undefined) out.push(value);
  }
  return out;
}

// ---------- drafts ----------

async function putDraft(draft: PendingDraft): Promise<void> {
  await putSealed(DRAFTS, draft.noteId, draft);
}

async function getDraft(noteId: string): Promise<PendingDraft | undefined> {
  return getSealed<PendingDraft>(DRAFTS, noteId);
}

async function deleteDraft(noteId: string): Promise<void> {
  await run<undefined>(DRAFTS, "readwrite", (s) => s.delete(noteId), undefined);
}

async function listDrafts(): Promise<PendingDraft[]> {
  return getAllSealed<PendingDraft>(DRAFTS);
}

// ---------- 노트 사본 ----------

async function putNote(note: NoteDetail): Promise<void> {
  const k = vaultKey;
  if (!k || !isActive()) return;
  const sealed = await seal(k, note);
  const db = await openDb();
  if (!db) return;
  // 사본과 버전 번호를 한 트랜잭션으로 쓴다 (둘이 어긋나면 낡은 사본을 최신으로 착각한다).
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([NOTES, SEQS], "readwrite");
      tx.objectStore(NOTES).put(sealed, note.id);
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
  return getSealed<NoteDetail>(NOTES, id);
}

async function deleteNote(id: string): Promise<void> {
  await run<undefined>(NOTES, "readwrite", (s) => s.delete(id), undefined);
  await run<undefined>(SEQS, "readwrite", (s) => s.delete(id), undefined);
}

async function listNotes(): Promise<NoteDetail[]> {
  return getAllSealed<NoteDetail>(NOTES);
}

/** 사본마다의 change_seq (본문은 읽지도 풀지도 않는다). */
async function noteSeqs(): Promise<Map<string, number>> {
  const keys = await run<IDBValidKey[]>(SEQS, "readonly", (s) => s.getAllKeys(), []);
  const values = await run<number[]>(SEQS, "readonly", (s) => s.getAll(), []);
  const out = new Map<string, number>();
  keys.forEach((key, i) => out.set(String(key), values[i]));
  return out;
}

// ---------- kv ----------

async function setKv(key: string, value: unknown): Promise<void> {
  await putSealed(KV, key, value);
}

async function getKv<T>(key: string): Promise<T | undefined> {
  return getSealed<T>(KV, key);
}

/**
 * 브라우저가 디스크가 부족할 때 이 사이트의 저장소를 지우지 않도록 요청한다.
 * 거절돼도 동작에는 문제없다 (원본은 서버에 있다).
 */
async function requestPersistence(): Promise<boolean> {
  if (!isActive()) return false;
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export const offlineStore = {
  isSupported,
  keepOnDevice,
  setKeepOnDevice,
  isUnlocked,
  isActive,
  unlock,
  wipeAll,
  purgeIfDisabled,
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
};
