/**
 * Memory Optimizer — normaliza, deduplica y limpia ruido.
 *
 * Corre dentro de la compactación periódica (cada N interacciones). No
 * resume con modelo: todas las operaciones son determinísticas y baratas,
 * aptas para correr en el hilo principal sin jank.
 */

const NOISE_REGEX = /^(hola|buenas|gracias|por favor|ok|dale|listo|perfecto|si|no)$/i;
const MAX_VALUE_CHARS = 60;

function normalizeValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/, "")
    .trim()
    .slice(0, MAX_VALUE_CHARS);
}

/**
 * Optimiza la memoria de largo plazo in-place:
 *  - normaliza valores (espacios, puntuación final, largo máximo),
 *  - deduplica valores de listas (case-insensitive),
 *  - elimina valores que son ruido conversacional,
 *  - elimina hechos que quedaron vacíos.
 *
 * Devuelve cuántos valores/hechos se eliminaron.
 */
export function optimizeLongTermFacts(ltm) {
  let removed = 0;

  for (const [path, fact] of Object.entries(ltm.facts || {})) {
    if (fact.values) {
      const seen = new Set();
      const cleaned = [];
      for (const raw of fact.values) {
        const value = normalizeValue(raw);
        const key = value.toLowerCase();
        if (!value || NOISE_REGEX.test(value) || seen.has(key)) {
          removed++;
          continue;
        }
        seen.add(key);
        cleaned.push(value);
      }
      if (!cleaned.length) {
        delete ltm.facts[path];
        removed++;
      } else {
        fact.values = cleaned;
      }
      continue;
    }

    const value = normalizeValue(fact.value);
    if (!value || NOISE_REGEX.test(value)) {
      delete ltm.facts[path];
      removed++;
    } else {
      fact.value = value;
    }
  }

  return removed;
}
