/**
 * Fuentes de datos remotas (ERP, CRM, etc.) bajo una convención estándar:
 *
 *   GET {baseUrl}/search?q={query}  → { items: [] }
 *   GET {baseUrl}/item/{id}         → { id, name, data }
 *   GET {baseUrl}/schema            → { name, description, availableEndpoints }
 *
 * Autenticación opcional por apiKey (header Authorization: Bearer).
 * Cada fuente se configura como { name, baseUrl, apiKey, enabled }.
 *
 * Cumple la interfaz BaseSource: { name, isEmpty, search, getItem,
 * searchSections, getSchema }. `isEmpty` es siempre `false` (la fuente
 * remota no sabe de antemano si tiene datos — el router la prueba en
 * cada turno). `searchSections` devuelve `{ items: [], total: 0 }` por
 * contrato: la convención remota no expone secciones, solo items planos.
 */

const DEFAULT_TIMEOUT_MS = 8000;

export function normalizeRemoteSources(sources = []) {
  if (!Array.isArray(sources)) return [];
  return sources
    .filter((s) => s && typeof s === "object")
    .map((s) => ({
      name: String(s.name || "").trim() || "Fuente externa",
      baseUrl: String(s.baseUrl || "").trim().replace(/\/+$/, ""),
      apiKey: String(s.apiKey || "").trim(),
      enabled: s.enabled !== false,
    }))
    .filter((s) => s.enabled && s.baseUrl);
}

export function createRemoteSource(config, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { name, baseUrl, apiKey } = config;

  async function request(path) {
    const headers = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: "GET",
        headers,
        signal: controller?.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    name,
    // Una fuente remota se considera "no vacía" por configuración: si el
    // baseUrl está definido, el router la prueba. La API responderá con
    // 404/500 si no hay datos, eso ya se maneja en `search()`.
    isEmpty: false,

    async search(query) {
      const payload = await request(`/search?q=${encodeURIComponent(query)}`);
      return { items: Array.isArray(payload?.items) ? payload.items : [] };
    },

    async getItem(id) {
      return request(`/item/${encodeURIComponent(id)}`);
    },

    /** Las fuentes remotas no exponen secciones en el contrato actual. */
    searchSections() {
      return { items: [], total: 0 };
    },

    /** Descubrimiento de capacidades. Best-effort: null si la API no lo expone. */
    async getSchema() {
      try {
        return await request("/schema");
      } catch {
        return null;
      }
    },
  };
}

/**
 * Registro de múltiples fuentes remotas con descubrimiento de schema.
 */
export function createRemoteRegistry(sourceConfigs = [], options = {}) {
  const sources = new Map(
    normalizeRemoteSources(sourceConfigs).map((cfg) => [
      cfg.name.toLowerCase(),
      createRemoteSource(cfg, options),
    ])
  );

  return {
    list() {
      return [...sources.values()].map((s) => s.name);
    },

    getSource(sourceName) {
      return sources.get(String(sourceName || "").toLowerCase()) || null;
    },

    get size() {
      return sources.size;
    },

    /** Consulta /schema de todas las fuentes en paralelo (best-effort). */
    async discoverSchemas() {
      const result = {};
      await Promise.all(
        [...sources.values()].map(async (source) => {
          result[source.name] = await source.getSchema();
        })
      );
      return result;
    },
  };
}
