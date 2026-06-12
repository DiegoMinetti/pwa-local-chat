/**
 * Extracción determinística de hechos (sin modelo).
 *
 * Misma filosofía que quickLookup: lo que se puede resolver con reglas no
 * pasa por el LLM. Convierte cada interacción en hechos estructurados con
 * path + importancia. No guarda saludos, charla trivial ni texto crudo.
 */

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const TOPIC_PATTERNS = [
  [/horario|abre|cierra/, "horario"],
  [/direc|ubica|calle|llegar|donde est/, "ubicación"],
  [/telefon|numero|contacto|whatsapp/, "teléfono"],
  [/pago|pagar|efectivo|tarjeta|transferencia|mercadopago/, "formas de pago"],
  [/promoci|descuento|oferta/, "promociones"],
  [/reserva/, "reservas"],
  [/wifi|internet/, "wifi"],
  [/delivery|domicilio|envio/, "delivery"],
  [/menu|carta|platos|opciones/, "menú"],
  [/vegetarian|vegano|sin gluten|celiac/, "opciones dietéticas"],
];

const ITEM_REGEX =
  /\b(caf[eé]|cortado|cappuccino|latte|medialunas?|tostado|s[aá]ndwich|jugo|agua|cerveza|vino|postre|torta|factura|croissant|submarino|t[eé])\b/gi;

const GREETING_REGEX = /^(hola|buenas|buen[oa]s\s|gracias|chau|adios|ok|dale|listo|perfecto)\b/i;

function cleanValue(value, maxChars = 60) {
  return value.replace(/\s+/g, " ").replace(/[.,;:!?]+$/, "").trim().slice(0, maxChars);
}

/**
 * @param {string} question - mensaje del cliente
 * @param {string} [answer] - respuesta del asistente (para detectar pendientes)
 * @returns {{ longTerm: Array<{path,value,importance,confidence}>, topics: string[], unresolved: boolean, trivial: boolean }}
 */
export function extractFacts(question, answer = "") {
  const text = question || "";
  const lower = normalize(text);
  const longTerm = [];
  const topics = [];

  // Nombre del cliente. El trigger es case-insensitive pero el nombre debe
  // empezar en mayúscula: «soy Diego» sí, «soy vegetariano» no.
  const nameMatch = text.match(
    /(?:me llamo|mi nombre es|soy|llamame|llámame)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]{2,20})/i
  );
  if (nameMatch && /^[A-ZÁÉÍÓÚÑ]/.test(nameMatch[1])) {
    longTerm.push({ path: "cliente.nombre", value: nameMatch[1], importance: 9, confidence: 0.95 });
  }

  // Alergias — crítico, nunca debe podarse (importance 10). Tolerante a
  // acentos («alérgico»/«alergia») y corta el valor en conjunciones.
  const allergyMatch = text.match(
    /al[eé]rgi(?:c[oa]s?|as?)\s+(?:al?\s+l?[oa]s?\s+|al\s+|a\s+)?([^.!?,\n]{2,40}?)(?=\s+(?:y|e|pero|aunque|también|tambien)\s|[.!?,\n]|$)/i
  );
  if (allergyMatch) {
    longTerm.push({ path: "cliente.alergias", value: cleanValue(allergyMatch[1]), importance: 10, confidence: 0.95 });
  }

  // Dieta declarada.
  const dietMatch = lower.match(/\b(vegetarian[oa]|vegan[oa]|celiac[oa])\b|\bsin gluten\b/);
  if (dietMatch && /\b(soy|como|llevo dieta|no como)\b/.test(lower)) {
    longTerm.push({ path: "cliente.dieta", value: dietMatch[0], importance: 9, confidence: 0.9 });
  }

  // Preferencias y rechazos.
  const likeMatch = text.match(/(?:prefiero|me gusta|me encanta|siempre pido)\s+([^.!?\n]{2,40})/i);
  if (likeMatch) {
    longTerm.push({ path: "cliente.preferencias", value: cleanValue(likeMatch[1]), importance: 7, confidence: 0.85 });
  }
  const dislikeMatch = text.match(/(?:no me gusta|odio|nunca pido|no quiero)\s+([^.!?\n]{2,40})/i);
  if (dislikeMatch) {
    longTerm.push({ path: "cliente.evitar", value: cleanValue(dislikeMatch[1]), importance: 7, confidence: 0.85 });
  }

  // Pedidos explícitos.
  const orderMatch = text.match(
    /(?:quiero|pido|dame|traeme|tráeme|quisiera|pedi|pedí|voy a pedir|me pones|me ponés|me traes|me traés|me das)\s+([^.!?\n]{3,40})/i
  );
  if (orderMatch) {
    longTerm.push({ path: "pedidos.recientes", value: cleanValue(orderMatch[1]), importance: 6, confidence: 0.85 });
  }

  // Ítems mencionados.
  const items = text.match(ITEM_REGEX);
  if (items) {
    for (const item of new Set(items.map((i) => i.toLowerCase()))) {
      longTerm.push({ path: "pedidos.items", value: item, importance: 5, confidence: 0.8 });
    }
  }

  // Temas consultados → memoria de trabajo, no long-term.
  for (const [pattern, topic] of TOPIC_PATTERNS) {
    if (pattern.test(lower)) topics.push(topic);
  }

  // ¿La respuesta fue «no tengo ese dato»? → pregunta abierta.
  const unresolved = /no tengo esa informaci|no dispon|no lo tengo/i.test(answer || "");

  // Trivial: saludo/cortesía sin hechos ni temas — no merece memoria semántica.
  const trivial = GREETING_REGEX.test(text.trim()) && longTerm.length === 0 && topics.length === 0;

  return { longTerm, topics, unresolved, trivial };
}
