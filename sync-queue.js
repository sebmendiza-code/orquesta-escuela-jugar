// sync-queue.js — Cola persistente de resultados con sincronización idempotente hacia InstantDB.
//
// - Cada resultado recibe UNA sola vez un UUID (resultId) que se guarda en IndexedDB.
// - Ese mismo UUID se usa como id de la entidad en `scores` de InstantDB: reenviarlo hace un
//   "upsert" sobre la misma fila, por lo que el servidor nunca crea una segunda copia.
// - Un resultado solo pasa a "synced" después de leerlo de vuelta desde el servidor (queryOnce).
// - Los errores de red nunca borran resultados: quedan en "error" y se reintentan con espera progresiva.

export const SYNC_SCHEMA_VERSION = 1;
export const STATUS = { PENDING: 'pending', SYNCING: 'syncing', SYNCED: 'synced', ERROR: 'error' };

const DB_NAME = 'oefv-offline';
const DB_VERSION = 1;
const STORE_RESULTS = 'results';
const STORE_KV = 'kv';
const LS_FALLBACK_KEY = 'oefv-sync-queue-fallback';
const PROBE_ID = '00000000-0000-4000-8000-000000000000';

export function uuidv4() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* sigue con el método manual */ }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function withTimeout(promise, ms, label) {
  let timer = 0;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: tiempo agotado`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// ---------- IndexedDB con respaldo en localStorage ----------
let dbPromise = null;
let idbBroken = false;
function openIdb() {
  if (idbBroken || typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB no disponible'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const idb = req.result;
        if (!idb.objectStoreNames.contains(STORE_RESULTS)) idb.createObjectStore(STORE_RESULTS, { keyPath: 'resultId' });
        if (!idb.objectStoreNames.contains(STORE_KV)) idb.createObjectStore(STORE_KV, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('No se pudo abrir IndexedDB'));
      req.onblocked = () => reject(new Error('IndexedDB bloqueada'));
    }).catch((error) => { idbBroken = true; dbPromise = null; throw error; });
  }
  return dbPromise;
}

function idbRequest(storeName, mode, run) {
  return openIdb().then((idb) => new Promise((resolve, reject) => {
    const tx = idb.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    const req = run(store);
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Error de IndexedDB'));
    tx.onabort = () => reject(tx.error || new Error('Transacción cancelada (¿almacenamiento lleno?)'));
  }));
}

function lsReadAll() {
  try { const list = JSON.parse(localStorage.getItem(LS_FALLBACK_KEY) || '[]'); return Array.isArray(list) ? list : []; } catch (e) { return []; }
}
function lsWriteAll(list) {
  localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(list)); // puede lanzar si está lleno
}

async function putResult(record) {
  try {
    await idbRequest(STORE_RESULTS, 'readwrite', (store) => store.put(record));
    return true;
  } catch (error) {
    try {
      const list = lsReadAll().filter((r) => r.resultId !== record.resultId);
      list.push(record);
      lsWriteAll(list);
      return true;
    } catch (lsError) {
      console.warn('[sync] No se pudo guardar el resultado en el dispositivo.', error, lsError);
      return false;
    }
  }
}

async function getAllResults() {
  let fromIdb = [];
  try { fromIdb = (await idbRequest(STORE_RESULTS, 'readonly', (store) => store.getAll())) || []; } catch (e) { fromIdb = []; }
  const ids = new Set(fromIdb.map((r) => r.resultId));
  return fromIdb.concat(lsReadAll().filter((r) => !ids.has(r.resultId)));
}

export async function kvSet(key, value) {
  try { await idbRequest(STORE_KV, 'readwrite', (store) => store.put({ key, value, savedAt: Date.now() })); return true; } catch (e) { return false; }
}
export async function kvGet(key) {
  try { const row = await idbRequest(STORE_KV, 'readonly', (store) => store.get(key)); return row ? row.value : undefined; } catch (e) { return undefined; }
}

// ---------- Cola de sincronización ----------
export function createSyncQueue({ getDb, onChange = () => {} }) {
  let flushing = false;
  let reachable = false;
  let lastProbeAt = 0;
  let retryTimer = 0;
  let pendingIds = new Set();
  let counts = { pending: 0, error: 0, synced: 0 };

  async function refreshCounts() {
    const all = await getAllResults();
    counts = { pending: 0, error: 0, synced: 0 };
    pendingIds = new Set();
    all.forEach((r) => {
      if (r.status === STATUS.SYNCED) counts.synced++;
      else { pendingIds.add(r.resultId); if (r.status === STATUS.ERROR) counts.error++; else counts.pending++; }
    });
    return all;
  }

  function state() {
    return { reachable, flushing, pending: counts.pending, error: counts.error, unsynced: counts.pending + counts.error };
  }
  function emit(event) { try { onChange(state(), event); } catch (e) { /* la interfaz no debe romper la cola */ } }

  // Al abrir el juego, los registros que quedaron "sincronizando" (app cerrada a mitad) vuelven a pendiente.
  async function recoverInterrupted() {
    const all = await getAllResults();
    for (const r of all) {
      if (r.status === STATUS.SYNCING) await putResult({ ...r, status: STATUS.PENDING });
    }
    await refreshCounts();
    emit('ready');
  }

  // Comprueba que el SERVIDOR responde (no solo que haya red local).
  async function probe() {
    const db = getDb();
    lastProbeAt = Date.now();
    if (!db || typeof db.queryOnce !== 'function') { reachable = false; return false; }
    try {
      await withTimeout(db.queryOnce({ scores: { $: { where: { id: PROBE_ID } } } }), 8000, 'probe');
      reachable = true;
    } catch (e) {
      reachable = false;
    }
    return reachable;
  }

  async function enqueue({ playerId, game, score, name, avatar }) {
    const record = {
      resultId: uuidv4(),
      playerId,
      game,
      score: Math.max(0, Math.round(Number(score) || 0)),
      name,
      avatar: Number(avatar) || 0,
      finishedAt: Date.now(),
      status: STATUS.PENDING,
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      schemaVersion: SYNC_SCHEMA_VERSION,
    };
    const saved = await putResult(record);
    if (saved) { pendingIds.add(record.resultId); counts.pending++; }
    emit(saved ? 'queued' : 'queue-failed');
    if (saved) flush();
    return { saved, record };
  }

  async function sendOne(db, record) {
    await putResult({ ...record, status: STATUS.SYNCING });
    const payload = { name: record.name, game: record.game, score: record.score, timestamp: record.finishedAt, avatar: record.avatar, playerId: record.playerId, schemaVersion: record.schemaVersion };
    try {
      // Upsert sobre el mismo UUID: reenvíos repetidos no crean filas nuevas en el servidor.
      // Si el servidor rechaza el reenvío (p. ej. permisos que bloquean "update" de una fila ya creada),
      // igual se verifica abajo si el resultado ya estaba guardado.
      let transactError = null;
      try {
        await withTimeout(Promise.resolve(db.transact(db.tx.scores[record.resultId].update(payload))), 15000, 'transact');
      } catch (error) { transactError = error; }
      if (transactError && !(await probe())) throw transactError;
      // Confirmación real: se vuelve a leer desde el servidor.
      const res = await withTimeout(db.queryOnce({ scores: { $: { where: { id: record.resultId } } } }), 10000, 'confirm');
      const row = res?.data?.scores?.[0];
      const exactMatch = row
        && row.id === record.resultId
        && row.game === record.game
        && Number(row.score) === record.score
        && row.name === record.name
        && Number(row.avatar) === record.avatar
        && row.playerId === record.playerId
        && Number(row.timestamp) === record.finishedAt
        && Number(row.schemaVersion) === record.schemaVersion;
      if (!exactMatch) throw new Error('El servidor no confirmó exactamente este resultado');
      await putResult({ ...record, status: STATUS.SYNCED, syncedAt: Date.now(), lastError: null });
      return true;
    } catch (error) {
      const attempts = (record.attempts || 0) + 1;
      const delay = Math.min(10 * 60 * 1000, 5000 * 2 ** Math.min(attempts - 1, 7));
      await putResult({ ...record, status: STATUS.ERROR, attempts, nextAttemptAt: Date.now() + delay, lastError: String(error?.message || error) });
      return false;
    }
  }

  async function flushInner() {
    const db = getDb();
    if (!db) { reachable = false; return; }
    if (!(await probe())) return;
    const all = await getAllResults();
    const now = Date.now();
    const due = all.filter((r) => (r.status === STATUS.PENDING || r.status === STATUS.ERROR) && (r.nextAttemptAt || 0) <= now)
      .sort((a, b) => a.finishedAt - b.finishedAt);
    if (!due.length) return;
    emit('sync-start');
    let ok = 0;
    for (const record of due) {
      if (await sendOne(db, record)) ok++;
      else if (!(await probe())) break; // el servidor dejó de responder: se reintenta luego
    }
    await refreshCounts();
    emit(ok && !counts.pending && !counts.error ? 'sync-done' : 'sync-partial');
  }

  // Un solo envío a la vez (también entre pestañas cuando el navegador ofrece Web Locks).
  async function flush() {
    if (flushing) return;
    flushing = true;
    emit('state');
    try {
      if (navigator.locks?.request) await navigator.locks.request('oefv-sync', { ifAvailable: true }, async (lock) => { if (lock) await flushInner(); });
      else await flushInner();
    } catch (e) {
      console.warn('[sync] Error inesperado al sincronizar; los resultados siguen guardados.', e);
    } finally {
      flushing = false;
      await refreshCounts().catch(() => {});
      emit('state');
      scheduleRetry();
    }
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    const wait = counts.pending + counts.error > 0 ? 15000 : 60000;
    retryTimer = setTimeout(() => { flush(); }, wait);
  }

  async function checkNow() {
    const was = reachable;
    await probe();
    if (reachable !== was) emit(reachable ? 'online' : 'offline');
    if (reachable) flush(); else emit('state');
  }

  window.addEventListener('online', () => { setTimeout(checkNow, 800); });
  window.addEventListener('offline', () => { reachable = false; emit('offline'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkNow(); });

  recoverInterrupted().then(() => scheduleRetry()).catch(() => {});

  return { enqueue, flush, checkNow, state, isUnconfirmed: (id) => pendingIds.has(id), lastProbeAt: () => lastProbeAt };
}
