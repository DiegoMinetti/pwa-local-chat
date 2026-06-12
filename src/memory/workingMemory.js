/**
 * Layer 2 — Memoria de trabajo.
 *
 * Estado activo de la charla: tema actual, temas activos recientes y
 * preguntas que el asistente no pudo responder. Tamaño acotado por diseño
 * (caps duros) + presupuesto de tokens al renderizar. Se actualiza en cada
 * interacción.
 */

import { estimateTokens } from "./tokenBudget";

const MAX_ACTIVE_TOPICS = 5;
const MAX_OPEN_QUESTIONS = 2;

export function createWorkingMemory() {
  return {
    temaActual: null,
    temasActivos: [], // más reciente al final
    pendientes: [], // preguntas sin respuesta (el bot dijo «no tengo el dato»)
    updatedAt: 0,
  };
}

export function updateWorkingMemory(wm, { question, topics = [], unresolved = false }) {
  const now = Date.now();

  if (topics.length) {
    wm.temaActual = topics[0];
    for (const topic of topics) {
      const idx = wm.temasActivos.indexOf(topic);
      if (idx !== -1) wm.temasActivos.splice(idx, 1);
      wm.temasActivos.push(topic);
    }
    if (wm.temasActivos.length > MAX_ACTIVE_TOPICS) {
      wm.temasActivos.splice(0, wm.temasActivos.length - MAX_ACTIVE_TOPICS);
    }
  }

  if (unresolved && question) {
    const clean = question.trim().slice(0, 80);
    if (!wm.pendientes.includes(clean)) {
      wm.pendientes.push(clean);
      if (wm.pendientes.length > MAX_OPEN_QUESTIONS) wm.pendientes.shift();
    }
  } else if (topics.length) {
    // Tema respondido → limpiar pendientes que matcheen el tema actual.
    wm.pendientes = wm.pendientes.filter(
      (p) => !topics.some((t) => p.toLowerCase().includes(t.toLowerCase()))
    );
  }

  wm.updatedAt = now;
  return wm;
}

/**
 * Render compacto estilo YAML. Si no entra en el presupuesto, descarta
 * líneas de menor valor (pendientes → temas activos → tema actual).
 */
export function renderWorkingMemory(wm, maxTokens) {
  if (!wm || maxTokens <= 0) return "";

  const lines = [];
  if (wm.temaActual) lines.push({ text: `tema_actual: ${wm.temaActual}`, priority: 3 });
  if (wm.temasActivos.length > 1) {
    lines.push({
      text: `temas_recientes: ${wm.temasActivos.slice(0, -1).join(", ")}`,
      priority: 2,
    });
  }
  if (wm.pendientes.length) {
    lines.push({ text: `sin_resolver: ${wm.pendientes.join(" | ")}`, priority: 1 });
  }
  if (!lines.length) return "";

  let candidate = lines;
  while (candidate.length && estimateTokens(candidate.map((l) => l.text).join("\n")) > maxTokens) {
    const minPriority = Math.min(...candidate.map((l) => l.priority));
    candidate = candidate.filter((l) => l.priority !== minPriority);
  }
  return candidate.map((l) => l.text).join("\n");
}
