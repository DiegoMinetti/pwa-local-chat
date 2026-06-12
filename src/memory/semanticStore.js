/**
 * Persistencia de la memoria semántica (Layer 4).
 *
 * Backend principal: IndexedDB (sobrevive recargas y modo offline; el quota
 * de localStorage es demasiado chico para cientos de entradas con vector).
 * Fallback: store en memoria, para tests (jsdom no trae IndexedDB) y para
 * navegadores con IDB bloqueado (modo privado en algunos engines).
 *
 * Esquema del object store `semantic_entries` (keyPath: `id`):
 *   {
 *     id: string,            // uuid-ish
 *     kind: string,          // "interaccion" | "descubrimiento" | ...
 *     text: string,          // texto recuperable (compacto, sin ruido)
 *     vector: number[],      // embedding serializado (Array, no Float32Array)
 *     importance: number,    // 1-10
 *     confidence: number,    // 0-1
 *     createdAt: number,     // epoch ms
 *     lastAccessed: number,  // epoch ms
 *     accessCount: number,
 *   }
 */

const DB_NAME = "pwa-chat-memory";
const DB_VERSION = 1;
const STORE_NAME = "semantic_entries";

export function createInMemorySemanticStore() {
  const entries = new Map();
  return {
    backend: "memory",
    async add(entry) {
      entries.set(entry.id, { ...entry });
      return entry.id;
    },
    async put(entry) {
      entries.set(entry.id, { ...entry });
    },
    async getAll() {
      return [...entries.values()].map((e) => ({ ...e }));
    },
    async remove(id) {
      entries.delete(id);
    },
    async clear() {
      entries.clear();
    },
    async count() {
      return entries.size;
    },
  };
}

function openDatabase(dbName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("No se pudo abrir IndexedDB."));
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Operación IndexedDB falló."));
  });
}

function createIndexedDbStore(db) {
  const withStore = (mode, fn) => {
    const tx = db.transaction(STORE_NAME, mode);
    return fn(tx.objectStore(STORE_NAME));
  };

  return {
    backend: "indexeddb",
    async add(entry) {
      await withStore("readwrite", (store) => requestToPromise(store.put(entry)));
      return entry.id;
    },
    async put(entry) {
      await withStore("readwrite", (store) => requestToPromise(store.put(entry)));
    },
    async getAll() {
      return withStore("readonly", (store) => requestToPromise(store.getAll()));
    },
    async remove(id) {
      await withStore("readwrite", (store) => requestToPromise(store.delete(id)));
    },
    async clear() {
      await withStore("readwrite", (store) => requestToPromise(store.clear()));
    },
    async count() {
      return withStore("readonly", (store) => requestToPromise(store.count()));
    },
  };
}

/**
 * Abre el mejor backend disponible. Nunca rechaza: si IndexedDB no está o
 * falla al abrir, devuelve el store en memoria (la app sigue funcionando,
 * solo pierde persistencia entre sesiones).
 */
export async function openSemanticStore({ dbName = DB_NAME } = {}) {
  if (typeof indexedDB === "undefined") {
    return createInMemorySemanticStore();
  }
  try {
    const db = await openDatabase(dbName);
    return createIndexedDbStore(db);
  } catch {
    return createInMemorySemanticStore();
  }
}
