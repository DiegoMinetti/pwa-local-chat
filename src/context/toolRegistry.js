/**
 * Sistema de herramientas (tools).
 *
 * El modelo nunca recibe catálogos completos: pide datos vía tools. Dos vías:
 *
 *  1. Determinística (principal): el router (sourceRouter.js) decide qué
 *     tools ejecutar ANTES del prompt y el resultado viaja como
 *     «Datos recuperados». Confiable con modelos chicos.
 *  2. Por el modelo (segunda chance): si al modelo le falta info puede emitir
 *     {"tool":"...","args":{...}}; parseToolCall() lo detecta, se ejecuta la
 *     tool y se repregunta con el dato. Una sola iteración.
 *
 * Tools default: searchProducts, getProduct, searchDocuments, fetchExternalData.
 */

import { makeCacheKey } from "./cache";

export function createToolRegistry() {
  const tools = new Map();

  return {
    register({ name, description, parameters = {}, run }) {
      if (!name || typeof run !== "function") {
        throw new Error("Tool inválida: requiere name y run().");
      }
      tools.set(name, { name, description: description || "", parameters, run });
    },

    get(name) {
      return tools.get(name) || null;
    },

    list() {
      return [...tools.values()];
    },
  };
}

/**
 * Tools estándar conectadas a la fuente local y al registro remoto.
 * `paths` de productos: colecciones bajo `menu` (catálogo gastronómico);
 * para un e-commerce sería `products`.
 */
export function registerDefaultTools(registry, { localSource, remoteRegistry }) {
  registry.register({
    name: "searchProducts",
    description: "Busca productos/platos del menú por palabras clave.",
    parameters: { query: "string" },
    run: ({ query }) =>
      localSource && !localSource.isEmpty
        ? localSource.search(query, { paths: ["menu", "products", "productos"] })
        : { items: [], total: 0 },
  });

  registry.register({
    name: "getProduct",
    description: "Obtiene un producto puntual por id o nombre exacto.",
    parameters: { id: "string" },
    run: ({ id }) => (localSource ? localSource.getItem(id) : null),
  });

  registry.register({
    name: "searchDocuments",
    description: "Busca información general del negocio (horarios, políticas, servicios, FAQ).",
    parameters: { query: "string" },
    run: ({ query }) => {
      if (!localSource || localSource.isEmpty) return { items: [], total: 0 };
      const records = localSource.search(query);
      const sections = localSource.searchSections(query);
      return { items: [...sections.items, ...records.items], total: sections.total + records.total };
    },
  });

  registry.register({
    name: "fetchExternalData",
    description: "Consulta una fuente externa configurada (ERP, CRM) por query o id.",
    parameters: { source: "string", query: "string?", id: "string?" },
    run: async ({ source, query, id }) => {
      const remote = remoteRegistry?.getSource(source);
      if (!remote) return { error: `Fuente no configurada: ${source}` };
      if (id) return remote.getItem(id);
      return remote.search(query || "");
    },
  });

  return registry;
}

/**
 * Catálogo compacto para el system prompt (~10-15 tokens por tool).
 */
export function renderToolCatalog(registry) {
  return registry
    .list()
    .map((t) => {
      const params = Object.entries(t.parameters)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      return `- ${t.name}(${params}): ${t.description}`;
    })
    .join("\n");
}

/**
 * Detecta una llamada a tool en la salida del modelo:
 * un objeto JSON {"tool":"nombre","args":{...}} solo o embebido en texto.
 */
export function parseToolCall(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/\{[^{}]*"tool"\s*:\s*"([^"]+)"[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (!parsed.tool) return null;
    return { tool: parsed.tool, args: parsed.args || {} };
  } catch {
    return null;
  }
}

/**
 * Ejecuta una tool con caché y métricas. Devuelve
 * { tool, args, data, cached } o { tool, error }.
 */
export async function executeTool(registry, { tool, args = {} }, { cache = null, metrics = null } = {}) {
  const definition = registry.get(tool);
  if (!definition) {
    return { tool, error: `Tool desconocida: ${tool}` };
  }

  const cacheKey = makeCacheKey(tool, JSON.stringify(args));
  if (cache) {
    const cached = cache.get(cacheKey);
    metrics?.recordCache(cached !== undefined);
    if (cached !== undefined) {
      return { tool, args, data: cached, cached: true };
    }
  }

  try {
    metrics?.recordToolCall(tool);
    if (tool === "fetchExternalData") metrics?.recordApiCall(args.source);
    const data = await definition.run(args);
    if (cache && data !== undefined) cache.set(cacheKey, data);
    return { tool, args, data, cached: false };
  } catch (error) {
    return { tool, args, error: error instanceof Error ? error.message : String(error) };
  }
}
