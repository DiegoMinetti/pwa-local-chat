/**
 * Memory Manager — orquestador de las 4 capas.
 *
 *   Layer 1  conversationBuffer  conversación cruda reciente (FIFO acotado)
 *   Layer 2  workingMemory       estado activo de la charla
 *   Layer 3  longTermMemory      hechos durables estructurados
 *   Layer 4  semanticMemory      conocimiento recuperable por similitud
 *
 * Pipeline tras cada interacción (recordInteraction):
 *   analizar → extraer hechos → actualizar capas → persistir →
 *   compactar cada N interacciones (dedupe + poda + normalización).
 *
 * El costo de prompt queda acotado: el bloque de memoria nunca excede el
 * presupuesto recibido, sin importar cuántos miles de mensajes pasaron.
 */

import { createConversationBuffer, pushInteraction, renderConversationBuffer } from "./conversationBuffer";
import { createHashedEmbedder } from "./embeddings";
import { extractFacts } from "./factExtraction";
import { createLongTermMemory, pruneLongTermMemory, renderLongTermMemory, upsertFact } from "./longTermMemory";
import { optimizeLongTermFacts } from "./memoryOptimizer";
import { assembleMemoryContext } from "./promptAssembly";
import { createSemanticMemory } from "./semanticMemory";
import { createInMemorySemanticStore, openSemanticStore } from "./semanticStore";
import { allocateMemoryBudget, DEFAULT_MEMORY_RATIOS, estimateTokens } from "./tokenBudget";
import { createWorkingMemory, renderWorkingMemory, updateWorkingMemory } from "./workingMemory";

const STORAGE_KEY = "cafe-central-memory-v1";
const STORAGE_VERSION = 1;
const DEFAULT_COMPACT_EVERY = 20;

function loadPersistedState(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STORAGE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistState(storageKey, state) {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: STORAGE_VERSION,
        interactionCount: state.interactionCount,
        workingMemory: state.workingMemory,
        longTermMemory: state.longTermMemory,
        bufferPairs: state.buffer.pairs,
      })
    );
  } catch {
    // Quota o storage bloqueado: la memoria sigue viva en RAM.
  }
}

/**
 * @param {object} [options]
 * @param {string}  [options.storageKey]    - clave de localStorage (working/long-term/buffer).
 * @param {object}  [options.semanticStore] - store inyectable (tests).
 * @param {object}  [options.embedder]      - embedder inyectable (p.ej. con modelo).
 * @param {object}  [options.budgetRatios]  - reparto del presupuesto entre capas.
 * @param {number}  [options.compactEvery]  - interacciones entre compactaciones.
 * @param {number}  [options.maxRecentPairs]- pares crudos retenidos (Layer 1).
 * @param {number}  [options.maxFacts]      - cap de hechos long-term.
 * @param {number}  [options.maxSemanticEntries] - cap de entradas semánticas.
 */
export function createMemoryManager({
  storageKey = STORAGE_KEY,
  semanticStore = null,
  embedder = createHashedEmbedder(),
  budgetRatios = DEFAULT_MEMORY_RATIOS,
  compactEvery = DEFAULT_COMPACT_EVERY,
  maxRecentPairs = 8,
  maxFacts = 40,
  maxSemanticEntries = 400,
} = {}) {
  const persisted = loadPersistedState(storageKey);

  const state = {
    interactionCount: persisted?.interactionCount || 0,
    workingMemory: persisted?.workingMemory || createWorkingMemory(),
    longTermMemory: persisted?.longTermMemory || createLongTermMemory(),
    buffer: createConversationBuffer({ maxPairs: maxRecentPairs }),
  };
  if (persisted?.bufferPairs?.length) {
    state.buffer.pairs = persisted.bufferPairs.slice(-maxRecentPairs);
  }

  // El store semántico abre async; hasta que esté listo usamos uno en
  // memoria para no bloquear la primera respuesta.
  let semantic = createSemanticMemory({
    store: semanticStore || createInMemorySemanticStore(),
    embedder,
    maxEntries: maxSemanticEntries,
  });
  const semanticReady = semanticStore
    ? Promise.resolve()
    : openSemanticStore()
        .then((store) => {
          semantic = createSemanticMemory({ store, embedder, maxEntries: maxSemanticEntries });
        })
        .catch(() => {});

  async function compact() {
    const optimizedValues = optimizeLongTermFacts(state.longTermMemory);
    const prunedFacts = pruneLongTermMemory(state.longTermMemory, { maxFacts });
    let semanticRemoved = 0;
    try {
      semanticRemoved = await semantic.compact();
    } catch {
      // compactación semántica best-effort
    }
    return { optimizedValues, prunedFacts, semanticRemoved };
  }

  return {
    /**
     * Pipeline post-interacción. No bloquea la UI: las escrituras
     * semánticas y la compactación son async.
     *
     * @returns {{ compacted: boolean }}
     */
    async recordInteraction({ question, answer }) {
      const analysis = extractFacts(question, answer);

      // Layer 1: conversación cruda.
      pushInteraction(state.buffer, { question, answer });

      // Layer 2: estado activo.
      updateWorkingMemory(state.workingMemory, {
        question,
        topics: analysis.topics,
        unresolved: analysis.unresolved,
      });

      // Layer 3: hechos durables (dedupe/obsolescencia en upsertFact).
      const now = Date.now();
      for (const fact of analysis.longTerm) {
        upsertFact(state.longTermMemory, fact, now);
      }

      // Layer 4: conocimiento recuperable. Saludos y trivia no se guardan.
      if (!analysis.trivial) {
        const hasCriticalFact = analysis.longTerm.some((f) => f.importance >= 9);
        const compactAnswer = (answer || "").replace(/\s+/g, " ").trim().slice(0, 200);
        await semanticReady;
        await semantic
          .remember({
            text: `Cliente: ${(question || "").trim().slice(0, 140)} — Asistente: ${compactAnswer}`,
            kind: "interaccion",
            importance: hasCriticalFact ? 9 : analysis.longTerm.length ? 7 : 5,
          })
          .catch(() => {});
      }

      state.interactionCount += 1;

      // Compactación periódica.
      let compacted = false;
      if (state.interactionCount % compactEvery === 0) {
        await compact();
        compacted = true;
      }

      persistState(storageKey, state);
      return { compacted };
    },

    /**
     * Construye el bloque de memoria para la pregunta actual, dentro del
     * presupuesto total. El presupuesto no usado por una capa pasa a las
     * siguientes (la última en renderizarse es el buffer reciente, que
     * absorbe todo el sobrante).
     */
    async buildMemoryContext(question, totalBudget) {
      const budgets = allocateMemoryBudget(totalBudget, budgetRatios);

      let carry = 0;

      const workingText = renderWorkingMemory(state.workingMemory, budgets.working);
      carry += Math.max(0, budgets.working - estimateTokens(workingText));

      const longTermText = renderLongTermMemory(state.longTermMemory, budgets.longTerm + carry);
      carry = Math.max(0, budgets.longTerm + carry - estimateTokens(longTermText));

      let semanticText = "";
      try {
        await semanticReady;
        const recalled = await semantic.recall(question, {
          topK: 3,
          minSimilarity: 0.3,
          maxTokens: budgets.semantic + carry,
        });
        // Excluir recuerdos que ya están verbatim en el buffer reciente:
        // duplicarían tokens sin sumar información.
        const recentQuestions = new Set(
          state.buffer.pairs.map((p) => p.question.trim().toLowerCase())
        );
        semanticText = recalled
          .filter((e) => {
            const match = e.text.match(/^Cliente:\s*(.+?)\s*—/);
            return !match || !recentQuestions.has(match[1].trim().toLowerCase());
          })
          .map((e) => `- ${e.text}`)
          .join("\n");
      } catch {
        semanticText = "";
      }
      carry = Math.max(0, budgets.semantic + carry - estimateTokens(semanticText));

      const recentText = renderConversationBuffer(state.buffer, budgets.recent + carry);

      return assembleMemoryContext({ workingText, longTermText, semanticText, recentText });
    },

    /**
     * Resumen para mostrar en Configuración (sin retrieval semántico:
     * no hay pregunta contra la cual buscar).
     */
    getDisplaySummary(maxTokens = 400) {
      return assembleMemoryContext({
        workingText: renderWorkingMemory(state.workingMemory, Math.floor(maxTokens * 0.2)),
        longTermText: renderLongTermMemory(state.longTermMemory, Math.floor(maxTokens * 0.3)),
        recentText: renderConversationBuffer(state.buffer, Math.floor(maxTokens * 0.5)),
      });
    },

    /** Compactación manual (expuesta para tests y mantenimiento). */
    compact,

    getStats() {
      return {
        interactionCount: state.interactionCount,
        bufferPairs: state.buffer.pairs.length,
        longTermFacts: Object.keys(state.longTermMemory.facts).length,
      };
    },

    async reset() {
      state.interactionCount = 0;
      state.workingMemory = createWorkingMemory();
      state.longTermMemory = createLongTermMemory();
      state.buffer = createConversationBuffer({ maxPairs: maxRecentPairs });
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // best-effort
      }
      await semanticReady;
      await semantic.clear().catch(() => {});
    },
  };
}
