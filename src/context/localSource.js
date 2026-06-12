/**
 * Fuente de datos local: consulta sobre un JSON (catálogo / documento del
 * negocio) SIN enviarlo nunca completo al modelo.
 *
 * El JSON se aplana en «colecciones»: cualquier array de objetos en cualquier
 * nivel se vuelve consultable (p.ej. `menu.destacados`, `sucursales`, `faq`,
 * `menu.categorias.cafeteria`). Las búsquedas devuelven solo los registros
 * relevantes, recortados a `maxResults`.
 *
 * Implementa la interfaz BaseSource: { name, isEmpty, search, getItem,
 * searchSections, getSchema }. Ver `baseSource.js` y `docs/source-contract.md`.
 */

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Palabras vacías que no aportan señal de búsqueda.
const STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al",
  "y", "o", "que", "cual", "cuales", "como", "para", "por", "con", "sin",
  "es", "son", "hay", "tiene", "tienen", "mas", "menos", "muy", "me", "te",
  "se", "su", "sus", "lo", "en", "a", "mi", "tu", "este", "esta", "ese",
  "esa", "quiero", "quisiera", "dame", "decime", "cuanto", "cuanta",
]);

function tokenize(query) {
  return normalize(query)
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Recorre el JSON y devuelve colecciones: arrays de objetos, indexados por
 * su path («menu.destacados»). Los objetos cuyos valores son arrays de
 * objetos (estilo `menu.categorias`) generan una colección por clave, con la
 * clave como categoría.
 */
export function flattenCollections(data, basePath = "", out = new Map()) {
  if (!data || typeof data !== "object") return out;

  for (const [key, value] of Object.entries(data)) {
    const path = basePath ? `${basePath}.${key}` : key;
    if (Array.isArray(value)) {
      const records = value.filter((v) => v && typeof v === "object");
      if (records.length) {
        out.set(path, records.map((r) => ({ ...r, _category: r.categoria ?? r.category ?? key })));
      }
    } else if (value && typeof value === "object") {
      flattenCollections(value, path, out);
    }
  }
  return out;
}

function scoreRecord(record, tokens) {
  const haystack = normalize(JSON.stringify(record));
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

/** Quita claves internas antes de exponer un registro al modelo. */
function publicRecord(record) {
  const { _category, ...rest } = record;
  return rest;
}

/**
 * @param {object|string} dataset - JSON parseado o string JSON.
 * @param {object} [options]
 * @param {number} [options.maxResults=5]
 * @param {string} [options.name="local"]
 */
export function createLocalSource(dataset, { maxResults = 5, name = "local" } = {}) {
  let data = dataset;
  if (typeof dataset === "string") {
    try {
      data = JSON.parse(dataset);
    } catch {
      data = null;
    }
  }

  const collections = data && typeof data === "object" ? flattenCollections(data) : new Map();

  function allRecords(filterPaths) {
    const records = [];
    for (const [path, items] of collections) {
      if (filterPaths && !filterPaths.some((p) => path.startsWith(p))) continue;
      for (const item of items) records.push({ path, item });
    }
    return records;
  }

  return {
    name,
    isEmpty: collections.size === 0,
    collectionPaths: [...collections.keys()],

    /**
     * Búsqueda por keywords sobre todas las colecciones (o un subconjunto de
     * paths). Devuelve solo los registros con score > 0, ordenados, top-N.
     */
    search(query, { paths = null, limit = maxResults } = {}) {
      const tokens = tokenize(query);
      if (!tokens.length) return { items: [], total: 0 };

      const scored = allRecords(paths)
        .map(({ path, item }) => ({ path, item, score: scoreRecord(item, tokens) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score);

      return {
        items: scored.slice(0, limit).map((r) => ({ ...publicRecord(r.item), _de: r.path })),
        total: scored.length,
      };
    },

    /** Registro puntual por id (campo `id` o `nombre` exacto, sin acentos). */
    getItem(id) {
      const target = normalize(id);
      for (const { item } of allRecords()) {
        if (String(item.id) === String(id)) return publicRecord(item);
        if (item.nombre && normalize(item.nombre) === target) return publicRecord(item);
        if (item.name && normalize(item.name) === target) return publicRecord(item);
      }
      return null;
    },

    /** Todos los registros cuya categoría (o path) matchea. */
    getByCategory(category, { limit = maxResults } = {}) {
      const target = normalize(category);
      const items = allRecords()
        .filter(
          ({ path, item }) =>
            normalize(item._category).includes(target) || normalize(path).includes(target)
        )
        .slice(0, limit)
        .map(({ item }) => publicRecord(item));
      return { items, total: items.length };
    },

    /**
     * Secciones no-colección del documento (objetos como `horarios`,
     * `local.politicas`) relevantes a la query. Complementa a search() para
     * datos que no son listas. Devuelve pares { path, value } compactos.
     */
    searchSections(query, { limit = 3 } = {}) {
      if (!data || typeof data !== "object") return { items: [], total: 0 };
      const tokens = tokenize(query);
      if (!tokens.length) return { items: [], total: 0 };

      const sections = [];
      for (const [key, value] of Object.entries(data)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const score = scoreRecord({ [key]: value }, tokens);
        if (score > 0) sections.push({ path: key, value, score });
      }
      sections.sort((a, b) => b.score - a.score);
      return {
        items: sections.slice(0, limit).map(({ path, value }) => ({ path, value })),
        total: sections.length,
      };
    },

    /**
     * Schema de la fuente: colecciones (paths con arrays de objetos) +
     * secciones (paths con objetos no-colección). Usado por la UI para
     * describir lo que la fuente expone y por el router para saber qué
     * herramientas tiene sentido registrar.
     */
    getSchema() {
      const collectionList = [...collections.entries()].map(([path, items]) => ({ path, count: items.length }));
      const sectionList = [];
      if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const [key, value] of Object.entries(data)) {
          if (!value || typeof value !== "object" || Array.isArray(value)) continue;
          sectionList.push({ path: key });
        }
      }
      return {
        name,
        collections: collectionList,
        sections: sectionList,
        isEmpty: collectionList.length === 0 && sectionList.length === 0,
      };
    },
  };
}
