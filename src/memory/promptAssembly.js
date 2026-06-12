/**
 * Ensamblado del bloque de memoria para el prompt.
 *
 * Orden fijo (de lo más estable a lo más inmediato — los modelos chicos
 * pesan más lo último, así la conversación reciente queda pegada a la
 * pregunta del cliente):
 *
 *   1. Memoria de trabajo  (estado actual)
 *   2. Largo plazo         (hechos del cliente)
 *   3. Semántica           (recuerdos relevantes a la pregunta)
 *   4. Buffer reciente     (conversación cruda)
 *
 * Este bloque se inyecta como `chatHistory` en buildMessages (chatbot.js),
 * que lo ubica bajo «Historial de conversación:» — nunca se inyecta el
 * historial completo.
 */

export function assembleMemoryContext({
  workingText = "",
  longTermText = "",
  semanticText = "",
  recentText = "",
} = {}) {
  const sections = [];

  if (workingText.trim()) sections.push(`Estado de la charla:\n${workingText.trim()}`);
  if (longTermText.trim()) sections.push(`Datos recordados del cliente:\n${longTermText.trim()}`);
  if (semanticText.trim()) sections.push(`Recuerdos relevantes:\n${semanticText.trim()}`);
  if (recentText.trim()) sections.push(`Conversación reciente:\n${recentText.trim()}`);

  return sections.join("\n\n");
}
