/**
 * Contexto dinámico por interacción:
 *
 *   { systemPrompt, memorySummary, recentMessages, retrievedData }
 *
 * `retrievedData` existe SOLO para el turno actual: se renderiza, viaja al
 * modelo y se descarta. Nunca se persiste en el contexto global.
 *
 * Este módulo deduplica, comprime y recorta los resultados de tools a un
 * presupuesto de tokens.
 */

import { estimateTokens } from "../memory/tokenBudget";

/** JSON minificado y sin claves internas, listo para el prompt. */
function compactJson(value) {
  return JSON.stringify(value, (key, v) => (key.startsWith("_") ? undefined : v));
}

/**
 * Deduplica resultados de tools: dos entradas con el mismo payload (o un
 * payload contenido en otro del mismo tool) no aportan tokens nuevos.
 */
export function dedupeRetrieved(results) {
  const seen = new Set();
  const out = [];
  for (const result of results) {
    if (!result || result.error) continue;
    const body = compactJson(result.data);
    if (!body || body === "null" || body === "[]" || body === '{"items":[],"total":0}') continue;
    if (seen.has(body)) continue;
    seen.add(body);
    out.push(result);
  }
  return out;
}

/**
 * Renderiza el bloque «Datos recuperados» dentro del presupuesto. Los
 * resultados van en orden del plan (remoto antes que local cuando el router
 * priorizó dato vivo); si no entran, se recortan los items de cada payload
 * antes de descartar payloads enteros.
 */
export function renderRetrievedData(results, maxTokens = 600) {
  const deduped = dedupeRetrieved(results);
  if (!deduped.length) return "";

  const lines = [];
  let used = 0;

  for (const { tool, data } of deduped) {
    let payload = data;
    let body = compactJson(payload);
    let cost = estimateTokens(body) + 8;

    // Compresión progresiva: recortar items hasta que entre.
    while (used + cost > maxTokens && Array.isArray(payload?.items) && payload.items.length > 1) {
      payload = { ...payload, items: payload.items.slice(0, Math.ceil(payload.items.length / 2)) };
      body = compactJson(payload);
      cost = estimateTokens(body) + 8;
    }
    if (used + cost > maxTokens) continue;

    lines.push(`[${tool}] ${body}`);
    used += cost;
  }

  return lines.join("\n");
}

/**
 * Ensambla los mensajes finales para el modelo con la estructura:
 * system prompt estable + bloque dinámico (info actual, memoria, datos
 * recuperados, pregunta). Devuelve además stats de tokens por sección.
 */
export function buildDynamicMessages({
  systemPrompt,
  identityLine = "",
  currentInfoLine = "",
  memorySummary = "",
  retrievedText = "",
  staticContexts = [],
  question,
}) {
  let userContent = "";

  if (identityLine) userContent += `${identityLine}\n`;
  if (currentInfoLine) userContent += `${currentInfoLine}\n`;

  for (const ctx of staticContexts) {
    if (ctx?.content?.trim()) {
      userContent += `\nContexto: ${ctx.name}\n${ctx.content.trim()}\n`;
    }
  }

  if (retrievedText) {
    userContent += `\nDatos recuperados (solo para esta consulta):\n${retrievedText}\n`;
  }

  if (memorySummary?.trim()) {
    userContent += `\nHistorial resumido:\n${memorySummary.trim()}\n`;
  }

  userContent += `\nPregunta: ${String(question || "").trim()}`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  return {
    messages,
    stats: {
      systemTokens: estimateTokens(systemPrompt),
      retrievedTokens: estimateTokens(retrievedText),
      memoryTokens: estimateTokens(memorySummary),
      totalTokens: estimateTokens(systemPrompt) + estimateTokens(userContent),
    },
  };
}
