/**
 * Layer 1 — Buffer de conversación reciente.
 *
 * Única capa con conversación cruda. Tamaño fijo en pares (FIFO) + tope de
 * tokens al renderizar. Prioriza lo más nuevo: si el presupuesto no alcanza,
 * la última interacción entra primero (es la que sostiene la coherencia
 * inmediata) y las anteriores se descartan de más vieja a más nueva.
 */

import { estimateTokens } from "./tokenBudget";

const DEFAULT_MAX_PAIRS = 8;

export function createConversationBuffer({ maxPairs = DEFAULT_MAX_PAIRS } = {}) {
  return { maxPairs, pairs: [] };
}

export function pushInteraction(buffer, { question, answer }) {
  buffer.pairs.push({ question: question || "", answer: answer || "", at: Date.now() });
  if (buffer.pairs.length > buffer.maxPairs) {
    buffer.pairs.splice(0, buffer.pairs.length - buffer.maxPairs);
  }
  return buffer;
}

function truncate(text, max) {
  if (!text) return "";
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const cut = slice.lastIndexOf(" ");
  return (cut > max * 0.6 ? slice.slice(0, cut) : slice).trimEnd() + "…";
}

/**
 * Render cronológico dentro del presupuesto. Recorre de la más nueva a la
 * más vieja sumando mientras entre, y devuelve en orden cronológico.
 */
export function renderConversationBuffer(
  buffer,
  maxTokens,
  { maxQuestionChars = 120, maxResponseChars = 240 } = {}
) {
  if (!buffer?.pairs?.length || maxTokens <= 0) return "";

  const selected = [];
  let usedTokens = 0;

  for (let i = buffer.pairs.length - 1; i >= 0; i--) {
    const { question, answer } = buffer.pairs[i];
    const block = `- Cliente: ${truncate(question, maxQuestionChars)}\n  Asistente: ${truncate(answer, maxResponseChars)}`;
    const cost = estimateTokens(block);

    if (usedTokens + cost > maxTokens) {
      // Intento agresivo solo para la interacción más reciente.
      if (selected.length === 0) {
        const tight = `- Cliente: ${truncate(question, 60)}\n  Asistente: ${truncate(answer, 120)}`;
        if (estimateTokens(tight) <= maxTokens) selected.unshift(tight);
      }
      break;
    }
    selected.unshift(block);
    usedTokens += cost;
  }

  return selected.join("\n");
}
