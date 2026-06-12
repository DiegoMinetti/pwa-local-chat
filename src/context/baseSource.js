/**
 * Interfaz BaseSource: contrato común para toda fuente de datos que el
 * agente consulta con tools.
 *
 * Toda fuente (local, remota, futura) expone:
 *
 *   name       string  — identificador estable para logs, tool calls, UI.
 *   isEmpty    boolean — true si la fuente no tiene datos (omite en router).
 *   search(query, opts?)         → { items: [...], total: number }
 *   getItem(id)                  → objeto | null
 *   searchSections(query, opts?) → { items: [...], total: number }
 *   getSchema()                  → { name, description, collections, sections }
 *
 * `searchSections` es opcional en el contrato; las fuentes que no tienen
 * "secciones" (objetos no-colección) devuelven `{ items: [], total: 0 }`.
 * `getSchema` puede ser sync (local) o async (remota) — el registry lo
 * unifica con Promise.resolve().
 *
 * No hay herencia: cualquier objeto que cumpla la forma es una BaseSource.
 * Esto mantiene `localSource.js` y `remoteSource.js` independientes y
 * permite a terceros registrar fuentes custom (ERP mock, archivo, etc.).
 *
 * Referencia: docs/source-contract.md (PR-D).
 */

const REQUIRED_METHODS = ["name", "isEmpty", "search", "getItem"];

/**
 * Type guard: verifica que un objeto cumple la interfaz BaseSource.
 * Lanza Error descriptivo si falta algún método; devuelve la fuente tal
 * cual si pasa.
 */
export function assertBaseSource(source) {
  if (!source || typeof source !== "object") {
    throw new Error("BaseSource: se esperaba un objeto fuente.");
  }
  for (const key of REQUIRED_METHODS) {
    const value = source[key];
    if (key === "name" || key === "isEmpty") {
      if (typeof value === "undefined") {
        throw new Error(`BaseSource: falta la propiedad '${key}'.`);
      }
    } else if (typeof value !== "function") {
      throw new Error(`BaseSource: el método '${key}' debe ser función.`);
    }
  }
  if (typeof source.name !== "string" || !source.name.trim()) {
    throw new Error("BaseSource: 'name' debe ser un string no vacío.");
  }
  if (typeof source.isEmpty !== "boolean") {
    throw new Error("BaseSource: 'isEmpty' debe ser boolean.");
  }
  return source;
}

/**
 * Normaliza los resultados de search() a `{ items, total }`. Útil para
 * fuentes que ya cumplen el contrato (casi todas) — idem-potente.
 */
export function normalizeSearchResult(result) {
  if (!result) return { items: [], total: 0 };
  if (Array.isArray(result)) {
    return { items: result, total: result.length };
  }
  const items = Array.isArray(result.items) ? result.items : [];
  const total = Number.isFinite(result.total) ? result.total : items.length;
  return { items, total };
}

/**
 * Adapter mínimo: convierte un objeto `{ name, data }` en BaseSource.
 * Sirve para tests y para envolver datasets estáticos sin escribir la
 * implementación completa. Las búsquedas son keyword-based sobre el JSON
 * (mismo motor que localSource.js, pero inyectable).
 */
export function createStaticSource({ name, data, search = defaultKeywordSearch }) {
  assertBaseSource({ name, isEmpty: !data, search: () => ({ items: [], total: 0 }), getItem: () => null });
  return {
    name,
    isEmpty: !data || (typeof data === "object" && Object.keys(data).length === 0),
    search(query, opts) {
      if (this.isEmpty) return { items: [], total: 0 };
      return search(data, query, opts);
    },
    getItem(id) {
      if (this.isEmpty || !data || typeof data !== "object") return null;
      const target = String(id || "").toLowerCase();
      const idStr = String(id);
      // Recorre recursivamente para encontrar el item dentro de arrays
      // anidados (mismo modelo que `flattenCollections`).
      const stack = [data];
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== "object") continue;
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              if (!item || typeof item !== "object") continue;
              if (String(item.id ?? "") === idStr) return item;
              if (typeof item.nombre === "string" && item.nombre.toLowerCase() === target) return item;
              if (typeof item.name === "string" && item.name.toLowerCase() === target) return item;
            }
          } else if (value && typeof value === "object") {
            stack.push(value);
          }
        }
      }
      return null;
    },
    searchSections(query, { limit = 3 } = {}) {
      if (this.isEmpty || !data || typeof data !== "object") return { items: [], total: 0 };
      const tokens = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
      if (!tokens.length) return { items: [], total: 0 };
      const sections = [];
      const visit = (node, path) => {
        if (!node || typeof node !== "object") return;
        for (const [key, value] of Object.entries(node)) {
          const next = path ? `${path}.${key}` : key;
          if (!value || typeof value !== "object" || Array.isArray(value)) continue;
          const haystack = JSON.stringify(value).toLowerCase();
          const score = tokens.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
          if (score > 0) sections.push({ path: next, value, score });
          visit(value, next);
        }
      };
      visit(data, "");
      sections.sort((a, b) => b.score - a.score);
      return { items: sections.slice(0, limit).map(({ path, value }) => ({ path, value })), total: sections.length };
    },
    getSchema() {
      if (this.isEmpty) return { name, collections: [], sections: [] };
      const collections = [];
      const sections = [];
      const stack = [{ node: data, path: "" }];
      while (stack.length) {
        const { node, path } = stack.pop();
        if (!node || typeof node !== "object") continue;
        for (const [k, v] of Object.entries(node)) {
          const next = path ? `${path}.${k}` : k;
          if (Array.isArray(v) && v.length && v.every((item) => item && typeof item === "object")) {
            collections.push({ path: next, count: v.length });
          } else if (v && typeof v === "object") {
            sections.push({ path: next });
            stack.push({ node: v, path: next });
          }
        }
      }
      return { name, collections, sections };
    },
  };
}

function defaultKeywordSearch(data, query) {
  const tokens = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { items: [], total: 0 };
  // Aplana recursivamente para encontrar arrays de objetos en cualquier
  // nivel (mismo principio que `flattenCollections` en localSource.js).
  const flattened = new Map();
  const walk = (value, path) => {
    if (!value || typeof value !== "object") return;
    for (const [k, v] of Object.entries(value)) {
      const next = path ? `${path}.${k}` : k;
      if (Array.isArray(v)) {
        flattened.set(next, v);
      } else if (v && typeof v === "object") {
        walk(v, next);
      }
    }
  };
  walk(data, "");

  const items = [];
  for (const [path, records] of flattened) {
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      if (!record || typeof record !== "object") continue;
      const haystack = JSON.stringify(record).toLowerCase();
      const score = tokens.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
      if (score > 0) items.push({ ...record, _de: path, _score: score });
    }
  }
  items.sort((a, b) => b._score - a._score);
  return { items: items.map(({ _de, _score, ...rest }) => ({ ...rest, _de })), total: items.length };
}
