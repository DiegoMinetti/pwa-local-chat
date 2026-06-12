/**
 * Selección automática de fuente: analiza la consulta y decide qué datos
 * hacen falta ANTES de armar el prompt.
 *
 *   memoria → la respuesta está en la conversación (no se ejecuta nada;
 *             la memoria jerárquica ya viaja siempre).
 *   local   → catálogo/documento local vía searchProducts/searchDocuments.
 *   remota  → fuentes externas configuradas vía fetchExternalData.
 *   ninguna → saludos / charla trivial: cero retrieval.
 *
 * Determinístico a propósito: los modelos chicos del navegador no hacen
 * tool-calling nativo confiable; el router garantiza el caso común y el
 * tool-call emitido por el modelo queda como segunda chance.
 */

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const GREETING = /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|gracias|chau|adios|ok|dale|perfecto|genial)[\s!.]*$/;

const MEMORY_HINTS =
  /\b(antes|recien|dijiste|te dije|dije|mi nombre|me llamo|habiamos|hablamos|anterior|ultima vez|recordas|acordas|pedi antes|lo mismo)\b/;

const PRODUCT_HINTS =
  /\b(producto|plato|menu|carta|precio|cuesta|vale|sale|cuanto|barat|car[oa]s?|cafe|brunch|desayun|almuerzo|merienda|postre|torta|medialuna|tostado|sandwich|jugo|bebida|cerveza|vino|destacad|recomend|notebook|stock)\b/;

const REMOTE_HINTS = /\b(stock|disponibilidad|pedido|orden|factura|cliente|erp|crm|sistema|tiempo real|actualizado)\b/;

/**
 * @param {string} question
 * @param {object} [options]
 * @param {boolean} [options.hasLocalData]
 * @param {string[]} [options.remoteSources] - nombres de fuentes configuradas.
 * @returns {{ needsData: boolean, source: string, toolPlan: Array<{tool, args}> }}
 */
export function routeQuery(question, { hasLocalData = false, remoteSources = [] } = {}) {
  const q = normalize(question);

  if (!q || GREETING.test(q.trim())) {
    return { needsData: false, source: "ninguna", toolPlan: [] };
  }

  if (MEMORY_HINTS.test(q) && !PRODUCT_HINTS.test(q)) {
    return { needsData: false, source: "memoria", toolPlan: [] };
  }

  const toolPlan = [];

  // Remota primero: si la pregunta huele a dato vivo y hay fuentes, las
  // consultamos además de lo local (el dato remoto pisa al estático).
  if (remoteSources.length && REMOTE_HINTS.test(q)) {
    for (const source of remoteSources) {
      toolPlan.push({ tool: "fetchExternalData", args: { source, query: question } });
    }
  }

  if (hasLocalData) {
    if (PRODUCT_HINTS.test(q)) {
      toolPlan.push({ tool: "searchProducts", args: { query: question } });
    }
    // Catch-all local: cualquier consulta no trivial busca también en el
    // documento general. Barato (es local) y evita falsos negativos del
    // matcheo por keywords.
    toolPlan.push({ tool: "searchDocuments", args: { query: question } });
  }

  if (!toolPlan.length) {
    return { needsData: false, source: "memoria", toolPlan: [] };
  }

  const source = toolPlan.some((t) => t.tool === "fetchExternalData")
    ? "remota"
    : "local";

  return { needsData: true, source, toolPlan };
}
