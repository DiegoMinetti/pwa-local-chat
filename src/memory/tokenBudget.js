/**
 * Presupuesto de tokens para el bloque de memoria.
 *
 * El bloque de memoria completo (working + long-term + semántica + buffer
 * reciente) comparte un presupuesto total que viene de computeHistoryBudget
 * (chatbot.js). Acá se reparte ese total entre capas con ratios configurables
 * y se redistribuye lo que una capa no usa hacia las siguientes.
 */

export function estimateTokens(text) {
  if (!text) return 0;
  // ~1 token cada 4 caracteres en español (misma heurística que chatbot.js).
  return Math.ceil(text.length / 4);
}

/**
 * Ratios por capa sobre el presupuesto total del bloque de memoria.
 * El buffer reciente lleva la porción mayor: es lo que más coherencia
 * inmediata aporta en modelos chicos (0.5B-1.5B).
 */
export const DEFAULT_MEMORY_RATIOS = {
  working: 0.15,
  longTerm: 0.2,
  semantic: 0.3,
  recent: 0.35,
};

const MIN_LAYER_TOKENS = 20;

/**
 * Reparte `totalTokens` entre capas según ratios. Garantiza un mínimo por
 * capa cuando el total lo permite.
 *
 * @returns {{ working: number, longTerm: number, semantic: number, recent: number }}
 */
export function allocateMemoryBudget(totalTokens, ratios = DEFAULT_MEMORY_RATIOS) {
  const total = Math.max(0, Math.floor(totalTokens) || 0);
  const merged = { ...DEFAULT_MEMORY_RATIOS, ...ratios };
  const sum = merged.working + merged.longTerm + merged.semantic + merged.recent;

  const allocate = (ratio) => Math.max(MIN_LAYER_TOKENS, Math.floor((total * ratio) / sum));

  if (total < MIN_LAYER_TOKENS * 4) {
    // Presupuesto mínimo: todo al buffer reciente, que es lo único
    // imprescindible para no perder el hilo de la charla.
    return { working: 0, longTerm: 0, semantic: 0, recent: total };
  }

  return {
    working: allocate(merged.working),
    longTerm: allocate(merged.longTerm),
    semantic: allocate(merged.semantic),
    recent: allocate(merged.recent),
  };
}
