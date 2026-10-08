const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const ts = require("../web/node_modules/typescript");

function loadModule(file, globals) {
  const source = fs.readFileSync(path.join(__dirname, "../web/src/lib", file), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {}, ...globals };
  vm.runInNewContext(js, context);
  return context.exports;
}

function environment() {
  const values = new Map();
  const connections = new Set();
  const rows = new Map();
  const state = { failOpen: false, abortWrite: false, deleted: false, deleteRequest: null };
  function finishDelete() {
    if (state.deleteRequest && connections.size === 0) {
      const req = state.deleteRequest;
      state.deleteRequest = null;
      rows.clear();
      state.deleted = true;
      queueMicrotask(() => req.onsuccess());
    }
  }
  const indexedDB = {
    open() {
      const req = {};
      queueMicrotask(() => {
        if (state.failOpen) return req.onerror();
        const db = {
          close() { connections.delete(db); finishDelete(); },
          transaction(name) {
            const tx = {};
            tx.objectStore = () => ({
              put(value, key) {
                const request = { result: key };
                // IDB requests can succeed before their enclosing transaction aborts.
                queueMicrotask(() => {
                  request.onsuccess?.();
                  queueMicrotask(() => {
                    if (state.abortWrite) tx.onabort?.();
                    else {
                      rows.set(`${name}:${key}`, value);
                      tx.oncomplete?.();
                    }
                  });
                });
                return request;
              },
              getAll() {
                const request = { result: [...rows].filter(([key]) => key.startsWith(`${name}:`)).map(([, value]) => value) };
                queueMicrotask(() => request.onsuccess());
                return request;
              },
            });
            return tx;
          },
        };
        connections.add(db);
        req.result = db;
        req.onsuccess();
      });
      return req;
    },
    deleteDatabase() {
      const req = {};
      state.deleteRequest = req;
      queueMicrotask(() => {
        for (const db of [...connections]) db.onversionchange?.();
        if (connections.size) req.onblocked?.();
        finishDelete();
      });
      return req;
    },
  };
  function tab() {
    const listeners = new Map();
    const window = {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      },
      addEventListener: (name, handler) => listeners.set(name, handler),
      setTimeout,
      clearTimeout,
    };
    const { offlineStore } = loadModule("offlineStore.ts", {
      window, indexedDB, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, btoa, atob,
    });
    return { store: offlineStore, listeners };
  }
  return { state, rows, connections, tab };
}

const draft = { noteId: "review", title: "Title", content: "Unsent edit", baseRevision: 1, baseTitle: "Title", baseContent: "", updatedAt: 1 };

async function main() {
  const env = environment();
  const first = env.tab();
  assert.equal(await first.store.putDraft(draft), false, "disabled storage must not claim success");
  await first.store.setKeepOnDevice(true);
  assert.equal(await first.store.unlock("test-password", true), "ok");
  env.state.failOpen = true;
  assert.equal(await first.store.putDraft(draft), false, "open failure must not claim success");
  env.state.failOpen = false;
  env.state.abortWrite = true;
  assert.equal(await first.store.putDraft(draft), false, "request success followed by transaction abort is a failure");
  assert.equal(env.rows.size, 0);
  env.state.abortWrite = false;
  assert.equal(await first.store.putDraft(draft), true, "only committed writes succeed");
  assert.equal((await first.store.listDrafts())[0].content, draft.content);
  const stored = env.rows.get("drafts:review");
  assert.equal(JSON.stringify(stored).includes(draft.content), false, "stored draft must be encrypted");

  const second = env.tab();
  assert.equal(await second.store.unlock("test-password", false), "ok");
  await second.store.listDrafts();
  assert.equal(env.connections.size, 2);
  await first.store.setKeepOnDevice(false);
  assert.equal(env.state.deleted, true);
  assert.equal(env.connections.size, 0);
  assert.equal(second.store.isUnlocked(), false, "other tab must forget its key on database deletion");

  const blocked = environment();
  const blockedTab = blocked.tab();
  // Simulate an older tab with no versionchange handler.
  blocked.connections.add({});
  let finished = false;
  const deleting = blockedTab.store.wipeAll().then(() => { finished = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(finished, false, "blocked deletion must remain pending");
  blocked.connections.clear();
  blocked.state.deleted = true;
  blocked.state.deleteRequest.onsuccess();
  await deleting;
  assert.equal(finished, true);

  const deletedCaches = [];
  const { clearLegacyNoteCaches } = loadModule("privacyCache.ts", {
    caches: { delete: async (name) => { deletedCaches.push(name); return true; } },
  });
  await clearLegacyNoteCaches();
  assert.deepEqual(deletedCaches.sort(), ["apis", "cross-origin"]);
  const unavailable = loadModule("privacyCache.ts", {});
  await unavailable.clearLegacyNoteCaches();
  const failedCleanup = loadModule("privacyCache.ts", {
    caches: { delete: async () => { throw new Error("Storage unavailable"); } },
  });
  await assert.rejects(failedCleanup.clearLegacyNoteCaches(), /Storage unavailable/);
  console.log("PASS: committed/encrypted drafts, failed and aborted writes, cross-tab lock/delete, blocked deletion, legacy cache cleanup");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
