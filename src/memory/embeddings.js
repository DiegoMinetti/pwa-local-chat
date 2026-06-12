/**
 * Embeddings determinísticos sin modelo (feature hashing).
 *
 * En este proyecto NO se descarga un modelo de embeddings: Safari iOS mata la
 * pestaña cerca de 1.5-2 GB y cada MB de descarga compite con los pesos del
 * LLM. En su lugar usamos el hashing trick clásico: unigramas (sin stopwords)
 * + trigramas de caracteres, hasheados a un vector denso de dimensión fija y
 * normalizado L2. Es determinístico, instantáneo y suficiente para recuperar
 * interacciones por solapamiento léxico/morfológico en español.
 */

const DEFAULT_DIM = 192;

const STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al",
  "a", "en", "y", "o", "u", "que", "se", "me", "mi", "tu", "su", "es", "son",
  "por", "para", "con", "sin", "como", "mas", "muy", "pero", "si", "no", "lo",
  "le", "les", "ya", "hay", "ser", "estar", "este", "esta", "eso", "esa",
]);

function normalizeForEmbedding(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** FNV-1a de 32 bits — rápido y con buena dispersión para strings cortos. */
function fnv1a(str, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Tokeniza en unigramas de palabra (peso 2) + trigramas de caracteres
 * (peso 1). Los trigramas dan robustez morfológica: «promoción», «promos»
 * y «promocional» comparten trigramas aunque difieran como palabras.
 */
export function tokenizeForEmbedding(text) {
  const normalized = normalizeForEmbedding(text);
  if (!normalized) return [];

  const tokens = [];
  for (const word of normalized.split(" ")) {
    if (word.length < 2 || STOPWORDS.has(word)) continue;
    tokens.push({ token: `w:${word}`, weight: 2 });
    if (word.length >= 4) {
      for (let i = 0; i <= word.length - 3; i++) {
        tokens.push({ token: `t:${word.slice(i, i + 3)}`, weight: 1 });
      }
    }
  }
  return tokens;
}

/**
 * Crea un embedder con dimensión fija. La API es la misma que tendría un
 * embedder con modelo (texto → Float32Array), así la capa semántica queda
 * agnóstica y se puede enchufar transformers.js en dispositivos potentes.
 */
export function createHashedEmbedder({ dim = DEFAULT_DIM } = {}) {
  return {
    dim,
    embed(text) {
      const vector = new Float32Array(dim);
      const tokens = tokenizeForEmbedding(text);
      if (!tokens.length) return vector;

      for (const { token, weight } of tokens) {
        const hash = fnv1a(token);
        const index = hash % dim;
        // Bit alto del hash como signo: reduce el sesgo de colisiones
        // (feature hashing con signo, Weinberger et al.).
        const sign = hash & 0x80000000 ? -1 : 1;
        vector[index] += sign * weight;
      }

      // Normalización L2 → la similitud coseno queda en producto punto.
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += vector[i] * vector[i];
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let i = 0; i < dim; i++) vector[i] /= norm;
      }
      return vector;
    },
  };
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
