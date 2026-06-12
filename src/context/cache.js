/**
 * Caché TTL para resultados de tools y APIs.
 *
 * Clave: `${source}::${query}`. Evita repetir búsquedas locales/remotas
 * dentro de la ventana de validez (default 5 min). Eviction FIFO simple
 * acotada por maxEntries para no crecer sin límite en sesiones largas.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function makeCacheKey(source, query) {
  return `${source}::${String(query).trim().toLowerCase()}`;
}

export function createTtlCache({ ttlMs = DEFAULT_TTL_MS, maxEntries = 100, now = Date.now } = {}) {
  const entries = new Map(); // key → { value, expiresAt }
  let hits = 0;
  let misses = 0;

  function evictExpired() {
    const t = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= t) entries.delete(key);
    }
  }

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry || entry.expiresAt <= now()) {
        if (entry) entries.delete(key);
        misses += 1;
        return undefined;
      }
      hits += 1;
      return entry.value;
    },

    set(key, value, customTtlMs) {
      evictExpired();
      // FIFO: Map preserva orden de inserción; sacamos el más viejo.
      while (entries.size >= maxEntries) {
        entries.delete(entries.keys().next().value);
      }
      entries.set(key, { value, expiresAt: now() + (customTtlMs ?? ttlMs) });
    },

    has(key) {
      const entry = entries.get(key);
      return Boolean(entry && entry.expiresAt > now());
    },

    clear() {
      entries.clear();
      hits = 0;
      misses = 0;
    },

    stats() {
      return { hits, misses, size: entries.size };
    },
  };
}
