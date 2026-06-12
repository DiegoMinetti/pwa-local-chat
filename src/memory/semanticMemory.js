/**
 * Layer 4 — Memoria semántica (conocimiento recuperable).
 *
 * Guarda interacciones/descubrimientos con embedding y los recupera por
 * similitud coseno contra la pregunta actual: top-K + umbral mínimo. El
 * scan es lineal sobre las entradas (cap ~400): con vectores de 192 dims
 * son <80k multiplicaciones por consulta — despreciable incluso en móviles.
 */

import { cosineSimilarity } from "./embeddings";
import { estimateTokens } from "./tokenBudget";

const DEFAULT_MAX_ENTRIES = 400;
const NEAR_DUPLICATE_SIMILARITY = 0.92;

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Score de retención: importancia + uso, penalizado por edad. Define qué
 * entradas sobreviven al pruning (importancia alta y uso frecuente viven más).
 */
export function retentionScore(entry, now = Date.now()) {
  const ageDays = Math.max(0, now - (entry.lastAccessed || entry.createdAt || now)) / 86400000;
  return (entry.importance || 5) + Math.log2(1 + (entry.accessCount || 0)) * 2 - ageDays / 14;
}

export function createSemanticMemory({ store, embedder, maxEntries = DEFAULT_MAX_ENTRIES }) {
  return {
    /**
     * Guarda conocimiento. Deduplica contra entradas casi idénticas
     * (coseno > 0.92): en ese caso refuerza la existente en lugar de
     * duplicar — la memoria mejora con el uso en vez de crecer.
     */
    async remember({ text, kind = "interaccion", importance = 5, confidence = 0.8 }) {
      const clean = (text || "").trim();
      if (clean.length < 12) return null; // sin sustancia, no se guarda

      const vector = embedder.embed(clean);
      const now = Date.now();

      const existing = await store.getAll();
      for (const entry of existing) {
        if (cosineSimilarity(vector, entry.vector) > NEAR_DUPLICATE_SIMILARITY) {
          const reinforced = {
            ...entry,
            importance: Math.max(entry.importance, importance),
            confidence: Math.min(1, (entry.confidence || 0.8) + 0.05),
            accessCount: (entry.accessCount || 0) + 1,
            lastAccessed: now,
          };
          await store.put(reinforced);
          return entry.id;
        }
      }

      const entry = {
        id: generateId(),
        kind,
        text: clean,
        vector: Array.from(vector),
        importance,
        confidence,
        createdAt: now,
        lastAccessed: now,
        accessCount: 0,
      };
      await store.add(entry);
      return entry.id;
    },

    /**
     * Recupera las entradas más similares a la consulta.
     * Top-K + umbral + presupuesto de tokens. Actualiza accessCount de lo
     * recuperado (las memorias usadas sobreviven más).
     */
    async recall(query, { topK = 3, minSimilarity = 0.3, maxTokens = Infinity } = {}) {
      const clean = (query || "").trim();
      if (!clean) return [];

      const queryVector = embedder.embed(clean);
      const entries = await store.getAll();
      const now = Date.now();

      const scored = entries
        .map((entry) => ({ entry, similarity: cosineSimilarity(queryVector, entry.vector) }))
        .filter(({ similarity }) => similarity >= minSimilarity)
        // Rerank liviano: similitud dominante + empuje por importancia.
        .sort(
          (a, b) =>
            b.similarity + b.entry.importance / 100 - (a.similarity + a.entry.importance / 100)
        )
        .slice(0, topK);

      const results = [];
      let usedTokens = 0;
      for (const { entry, similarity } of scored) {
        const cost = estimateTokens(entry.text);
        if (usedTokens + cost > maxTokens) continue;
        usedTokens += cost;
        results.push({ ...entry, similarity });
        // Refuerzo de uso, fire-and-forget: no bloquea la respuesta.
        store
          .put({ ...entry, accessCount: (entry.accessCount || 0) + 1, lastAccessed: now })
          .catch(() => {});
      }
      return results;
    },

    /**
     * Compactación: fusiona casi-duplicados y poda por score hasta el cap.
     * Devuelve cuántas entradas se eliminaron.
     */
    async compact() {
      const entries = await store.getAll();
      let removed = 0;

      // 1. Fusionar pares casi duplicados (sobrevive el de mayor score).
      const alive = [...entries].sort((a, b) => retentionScore(b) - retentionScore(a));
      const merged = new Set();
      for (let i = 0; i < alive.length; i++) {
        if (merged.has(alive[i].id)) continue;
        for (let j = i + 1; j < alive.length; j++) {
          if (merged.has(alive[j].id)) continue;
          if (cosineSimilarity(alive[i].vector, alive[j].vector) > NEAR_DUPLICATE_SIMILARITY) {
            alive[i].accessCount = (alive[i].accessCount || 0) + (alive[j].accessCount || 0);
            alive[i].importance = Math.max(alive[i].importance, alive[j].importance);
            merged.add(alive[j].id);
          }
        }
      }
      for (const id of merged) {
        await store.remove(id);
        removed++;
      }

      // 2. Poda por score si excede el cap. Importancia >= 9 nunca se borra.
      const survivors = alive.filter((e) => !merged.has(e.id));
      if (survivors.length > maxEntries) {
        const prunable = survivors
          .filter((e) => (e.importance || 5) < 9)
          .sort((a, b) => retentionScore(a) - retentionScore(b));
        const excess = survivors.length - maxEntries;
        for (const entry of prunable.slice(0, excess)) {
          await store.remove(entry.id);
          removed++;
        }
      }

      return removed;
    },

    async size() {
      return store.count();
    },

    async clear() {
      await store.clear();
    },
  };
}
