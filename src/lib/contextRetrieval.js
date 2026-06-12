/**
 * Selección de contexto relevante (RAG liviano, sin embeddings).
 *
 * En lugar de enviar todo el documento del negocio en cada turno, este módulo
 * elige solo las secciones del JSON que la pregunta necesita, respetando un
 * presupuesto de tokens. Reduce el prompt de ~1.600 tokens a ~300-500 por
 * interacción, lo que acelera el prefill (clave en móviles) y deja lugar para
 * historial y respuesta dentro de ventanas chicas (2048).
 */

/**
 * Cap duro al tamaño del bloque «Información del negocio» que se inyecta al
 * modelo. Es independiente del `maxTokens` que pasa el llamador: aunque el
 * presupuesto disponible sea mayor, nunca dejamos que el bloque del negocio
 * exceda este tope. Lo usamos para que el contexto del sistema se mantenga
 * por debajo del 50% de la ventana del modelo (con system + history + pregunta
 * + respuesta) en cualquier device.
 *
 * Valor actual: 800 tokens (≈3.200 caracteres). Si en el futuro querés
 * ajustar el límite, este es el único lugar que hay que tocar.
 */
export const BUSINESS_INFO_TOKEN_CAP = 800;

function estimateTokens(text) {
  if (!text) return 0;
  // ~1 token cada 4 caracteres en español (misma heurística que chatbot.js).
  return Math.ceil(text.length / 4);
}

function normalizeQuestion(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Mapeo pregunta → secciones top-level del JSON del negocio.
const SECTION_RULES = [
  {
    section: "horarios",
    pattern:
      /horari|abre|cierra|abierto|cerrad|feriado|navidad|fin de semana|ano nuevo|lunes|martes|miercoles|jueves|viernes|sabado|domingo|que hora|hasta cuando|desde cuando|cocina/,
  },
  {
    section: "sucursales",
    pattern:
      /direcci|donde|ubicaci|calle|barrio|sucursal|llegar|mapa|zona|acces|silla|rampa|exterior|terraza|capacidad|estacionamiento|mascota|pet/,
  },
  {
    section: "menu",
    pattern:
      /menu|carta|plato|comida|comer|precio|cuesta|vale|sale|cuanto|cafe|brunch|almuerzo|desayun|merienda|postre|torta|medialuna|tostado|sandwich|jugo|bebida|cerveza|vino|promo|oferta|descuento|destacad|recomend|signature/,
  },
  {
    section: "servicios",
    pattern:
      /pago|pagar|efectivo|tarjeta|credito|debito|mercado ?pago|transferencia|qr|delivery|envio|domicilio|takeaway|llevar|reserva|wifi|internet|servicio|promo|oferta|descuento|factura|facturac/,
  },
  {
    section: "dietas_y_opciones",
    pattern: /vegetarian|vegan|gluten|celiac|tacc|dieta|leche vegetal|almendra|soja|saludable/,
  },
  {
    section: "tiempos_promedio",
    pattern: /espera|demora|tarda|cuanto tiempo|rapido|al toque/,
  },
  {
    section: "recomendaciones_por_dia",
    pattern: /convien|mejor dia|cuando ir|menos gente|tranquilo|sin gente/,
  },
  {
    section: "local",
    pattern:
      /telefono|numero|contacto|mail|email|instagram|facebook|redes|web|sitio|nombre|quienes|que es|que hacen|descripcion|fundac|historia|politica|cancelacion|cancelar|facturar|factura/,
  },
];

// Secciones sin valor para responder al cliente: nunca se envían al modelo.
const EXCLUDED_SECTIONS = new Set(["metadata", "intenciones_soportadas"]);

// `local` (identidad del negocio) viaja siempre; `faq` es chico y de alto valor.
const ALWAYS_SECTIONS = ["local"];
const PRIORITY_EXTRAS = ["faq"];

// Si la pregunta no matchea ningún tema, este set cubre lo más consultado.
const DEFAULT_SECTIONS = ["local", "horarios", "servicios", "sucursales", "faq"];

function truncateAtBoundary(text, maxTokens) {
  if (estimateTokens(text) <= maxTokens) return text;
  const slice = text.slice(0, maxTokens * 4);
  const cut = slice.lastIndexOf("\n");
  return (cut > slice.length * 0.5 ? slice.slice(0, cut) : slice).trim();
}

/**
 * Devuelve las secciones del documento que matchean la pregunta.
 * Exportada para poder testearla de forma aislada.
 */
export function matchBusinessSections(question) {
  const q = normalizeQuestion(question);
  const matched = [];
  for (const { section, pattern } of SECTION_RULES) {
    if (pattern.test(q) && !matched.includes(section)) {
      matched.push(section);
    }
  }
  return matched;
}

/**
 * Selecciona el subconjunto del documento del negocio relevante a la pregunta,
 * dentro del presupuesto de tokens dado. Si el documento no es JSON se
 * devuelve (truncado al presupuesto) tal cual.
 *
 * @param {string} businessInfo - Documento completo (idealmente JSON).
 * @param {string} question     - Pregunta del cliente.
 * @param {number} maxTokens    - Presupuesto de tokens para este bloque.
 * @returns {string} JSON minificado con las secciones seleccionadas.
 */
export function selectRelevantBusinessInfo(businessInfo, question, maxTokens = 1200) {
  const raw = (businessInfo || "").trim();
  if (!raw) return "";

  // Cap duro: el bloque del negocio nunca excede BUSINESS_INFO_TOKEN_CAP,
  // sin importar el `maxTokens` que pase el llamador. Esto garantiza que
  // el contexto del sistema se mantenga acotado y no se coma más del 50%
  // de la ventana del modelo (con system prompt + history + pregunta + respuesta).
  const effectiveBudget = Math.min(maxTokens, BUSINESS_INFO_TOKEN_CAP);

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return truncateAtBoundary(raw, effectiveBudget);
  }

  const matched = matchBusinessSections(question);

  // Con match: contexto mínimo (identidad + secciones del tema + faq).
  // Sin match: set por defecto y, si sobra presupuesto, el resto del documento
  // como red de seguridad — no sabemos qué sección necesita la pregunta.
  const candidates = matched.length
    ? [...new Set([...ALWAYS_SECTIONS, ...matched, ...PRIORITY_EXTRAS])]
    : [
        ...new Set([
          ...DEFAULT_SECTIONS,
          ...Object.keys(data).filter((key) => !EXCLUDED_SECTIONS.has(key)),
        ]),
      ];

  const selected = {};
  let usedTokens = 0;

  for (const key of candidates) {
    if (data[key] === undefined || EXCLUDED_SECTIONS.has(key)) continue;

    const chunk = JSON.stringify(data[key]);
    const cost = estimateTokens(`"${key}":,`) + estimateTokens(chunk);
    if (usedTokens + cost > effectiveBudget) continue;

    selected[key] = data[key];
    usedTokens += cost;
  }

  // Presupuesto demasiado chico hasta para `local`: degradar a texto truncado
  // antes que mandar un contexto vacío.
  if (Object.keys(selected).length === 0) {
    return truncateAtBoundary(JSON.stringify(data.local ?? data), effectiveBudget);
  }

  return JSON.stringify(selected);
}
