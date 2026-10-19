// Local-first record store.
// Every piece of data is a record: { id, kind, data, updated_at, deleted, dirty }.
// Records live in memory for instant reads and are persisted to IndexedDB.
// `dirty` records are waiting to be pushed to Supabase by sync.js.

const DB_NAME = 'life-manager';
const DB_VERSION = 1;

let dbp = null;
const mem = new Map();
const listeners = new Set();

function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const s = t.objectStore(storeName);
    const out = fn(s);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

function persist(records) {
  return tx('records', 'readwrite', (s) => { for (const r of records) s.put(r); });
}

function emit(source) { for (const fn of listeners) fn(source); }

// Monotonic timestamp so two edits in the same millisecond still order correctly.
let lastStamp = 0;
function stamp() {
  let t = Date.now();
  if (t <= lastStamp) t = lastStamp + 1;
  lastStamp = t;
  return new Date(t).toISOString();
}

export const store = {
  async load() {
    const rows = await tx('records', 'readonly', (s) => s.getAll());
    mem.clear();
    for (const r of rows) mem.set(r.id, r);
  },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** Live items of a kind as plain objects: { id, ...data } */
  list(kind) {
    const out = [];
    for (const r of mem.values()) if (r.kind === kind && !r.deleted) out.push({ id: r.id, ...r.data });
    return out;
  },
  get(id) {
    const r = mem.get(id);
    return r && !r.deleted ? { id: r.id, ...r.data } : null;
  },
  /** Raw record, including deleted ones (used for undo). */
  raw(id) { return mem.get(id) || null; },

  async put(kind, obj, { silent = false } = {}) {
    const { id, ...data } = obj;
    const rec = { id, kind, data, updated_at: stamp(), deleted: false, dirty: 1 };
    mem.set(id, rec);
    await persist([rec]);
    if (!silent) emit('local');
    return rec;
  },

  async putMany(items) {
    const recs = items.map(([kind, { id, ...data }]) => ({ id, kind, data, updated_at: stamp(), deleted: false, dirty: 1 }));
    for (const r of recs) mem.set(r.id, r);
    await persist(recs);
    emit('local');
  },

  async patch(id, changes) {
    const r = mem.get(id);
    if (!r) return;
    return this.put(r.kind, { id, ...r.data, ...changes });
  },

  async remove(id) {
    const r = mem.get(id);
    if (!r) return;
    const rec = { ...r, deleted: true, updated_at: stamp(), dirty: 1 };
    mem.set(id, rec);
    await persist([rec]);
    emit('local');
  },

  async restore(id) {
    const r = mem.get(id);
    if (!r) return;
    const rec = { ...r, deleted: false, updated_at: stamp(), dirty: 1 };
    mem.set(id, rec);
    await persist([rec]);
    emit('local');
  },

  dirty() { return [...mem.values()].filter((r) => r.dirty); },

  /** After a successful push: clear dirty only if the record wasn't edited again meanwhile. */
  async markClean(pushed) {
    const changed = [];
    for (const p of pushed) {
      const cur = mem.get(p.id);
      if (cur && cur.updated_at === p.updated_at && cur.dirty) {
        const rec = { ...cur, dirty: 0 };
        mem.set(p.id, rec);
        changed.push(rec);
      }
    }
    if (changed.length) await persist(changed);
  },

  /** Merge rows from the server. Last write (by updated_at) wins. */
  async applyRemote(rows) {
    const changed = [];
    for (const row of rows) {
      const cur = mem.get(row.id);
      const remoteAt = new Date(row.updated_at).toISOString();
      if (cur && cur.updated_at >= remoteAt) continue;
      const rec = { id: row.id, kind: row.kind, data: row.data || {}, updated_at: remoteAt, deleted: !!row.deleted, dirty: 0 };
      mem.set(row.id, rec);
      changed.push(rec);
    }
    if (changed.length) {
      await persist(changed);
      emit('remote');
    }
    return changed.length;
  },

  async getMeta(key) {
    const r = await tx('meta', 'readonly', (s) => s.get(key));
    return r?.value;
  },
  async setMeta(key, value) {
    await tx('meta', 'readwrite', (s) => { s.put({ key, value }); });
  },

  exportJSON() {
    return JSON.stringify({ app: 'life-manager', version: 1, exported_at: new Date().toISOString(), records: [...mem.values()] }, null, 1);
  },

  async importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.records)) throw new Error('Not a Life Manager backup');
    const recs = parsed.records
      .filter((r) => r && r.id && r.kind)
      .map((r) => ({ id: r.id, kind: r.kind, data: r.data || {}, updated_at: stamp(), deleted: !!r.deleted, dirty: 1 }));
    for (const r of recs) mem.set(r.id, r);
    await persist(recs);
    emit('local');
    return recs.length;
  },

  async wipe() {
    mem.clear();
    await tx('records', 'readwrite', (s) => s.clear());
    await tx('meta', 'readwrite', (s) => s.clear());
    emit('local');
  },
};
