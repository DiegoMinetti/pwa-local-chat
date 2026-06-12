/**
 * Layer 3 — Memoria de largo plazo.
 *
 * Hechos durables estructurados: path → valor con metadatos de scoring
 * (importance, confidence, lastUpdated, accessCount). Nada de texto
 * conversacional: solo conocimiento normalizado.
 *
 * Paths de lista (alergias, preferencias, ítems) acumulan valores únicos;
 * paths escalares (nombre, dieta) se sobreescriben con el dato más nuevo
 * — un hecho nuevo invalida al obsoleto.
 */

import { estimateTokens } from "./tokenBudget";

const LIST_PATHS = new Set([
  "cliente.alergias",
  "cliente.preferencias",
  "cliente.evitar",
  "pedidos.items",
  "pedidos.recientes",
]);

const MAX_LIST_VALUES = 6;
const CRITICAL_IMPORTANCE = 9; // >= nunca se poda

export function createLongTermMemory() {
  return { facts: {} };
}

function normalizeValue(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sameValue(a, b) {
  return normalizeValue(a).toLowerCase() === normalizeValue(b).toLowerCase();
}

export function upsertFact(ltm, { path, value, importance = 5, confidence = 0.8 }, now = Date.now()) {
  const clean = normalizeValue(value);
  if (!path || !clean) return ltm;

  const existing = ltm.facts[path];

  if (LIST_PATHS.has(path)) {
    if (!existing) {
      ltm.facts[path] = {
        path,
        values: [clean],
        importance,
        confidence,
        lastUpdated: now,
        accessCount: 0,
        count: 1,
      };
      return ltm;
    }
    if (!existing.values.some((v) => sameValue(v, clean))) {
      existing.values.push(clean);
      if (existing.values.length > MAX_LIST_VALUES) existing.values.shift();
    }
    existing.importance = Math.max(existing.importance, importance);
    existing.confidence = Math.min(1, existing.confidence + 0.05);
    existing.lastUpdated = now;
    existing.count += 1;
    return ltm;
  }

  if (existing && sameValue(existing.value, clean)) {
    // Mismo hecho repetido → refuerza confianza, no duplica.
    existing.confidence = Math.min(1, existing.confidence + 0.1);
    existing.lastUpdated = now;
    existing.count += 1;
  } else {
    // Hecho nuevo o cambiado → reemplaza (detección de obsolescencia).
    ltm.facts[path] = {
      path,
      value: clean,
      importance,
      confidence,
      lastUpdated: now,
      accessCount: 0,
      count: 1,
    };
  }
  return ltm;
}

export function factScore(fact, now = Date.now()) {
  const ageDays = Math.max(0, now - (fact.lastUpdated || now)) / 86400000;
  return (
    (fact.importance || 5) +
    Math.log2(1 + (fact.accessCount || 0) + (fact.count || 1)) -
    ageDays / 30
  );
}

/**
 * Poda hechos de menor score cuando se excede el cap. Los hechos críticos
 * (importance >= 9: nombre, alergias, dieta) nunca se eliminan.
 */
export function pruneLongTermMemory(ltm, { maxFacts = 40 } = {}, now = Date.now()) {
  const all = Object.values(ltm.facts);
  if (all.length <= maxFacts) return 0;

  const prunable = all
    .filter((f) => (f.importance || 5) < CRITICAL_IMPORTANCE)
    .sort((a, b) => factScore(a, now) - factScore(b, now));

  let removed = 0;
  for (const fact of prunable.slice(0, all.length - maxFacts)) {
    delete ltm.facts[fact.path];
    removed++;
  }
  return removed;
}

/**
 * Render compacto agrupado por raíz del path, ordenado por importancia:
 *
 *   cliente: nombre=Diego; alergias=maní, nueces
 *   pedidos: items=cortado, medialunas
 *
 * Agrega líneas mientras entren en el presupuesto (las más importantes
 * primero, así un presupuesto chico conserva lo crítico).
 */
export function renderLongTermMemory(ltm, maxTokens, now = Date.now()) {
  const all = Object.values(ltm.facts || {});
  if (!all.length || maxTokens <= 0) return "";

  const byRoot = new Map();
  for (const fact of all) {
    const [root, ...rest] = fact.path.split(".");
    const key = rest.join(".") || root;
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push({ key, fact });
  }

  const lines = [];
  for (const [root, items] of byRoot) {
    items.sort((a, b) => b.fact.importance - a.fact.importance);
    const parts = items.map(({ key, fact }) =>
      fact.values ? `${key}=${fact.values.join(", ")}` : `${key}=${fact.value}`
    );
    const maxImportance = Math.max(...items.map(({ fact }) => fact.importance));
    lines.push({
      text: `${root}: ${parts.join("; ")}`,
      importance: maxImportance,
      facts: items.map(({ fact }) => fact),
    });
  }

  lines.sort((a, b) => b.importance - a.importance);

  const selected = [];
  let usedTokens = 0;
  for (const line of lines) {
    const cost = estimateTokens(line.text);
    if (usedTokens + cost > maxTokens) continue;
    selected.push(line.text);
    usedTokens += cost;
    // Marcar acceso solo de los hechos efectivamente renderizados: los
    // usados sobreviven más al pruning (factScore).
    for (const fact of line.facts) {
      fact.accessCount = (fact.accessCount || 0) + 1;
    }
  }
  void now;

  return selected.join("\n");
}
