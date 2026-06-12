import {
  AVAILABLE_MODELS,
  DEFAULT_FALLBACK_MODEL_IDS,
  MODEL_ID,
  getModelById,
  getRuntimeLabel,
} from "./modelCatalog";
import { selectRelevantBusinessInfo } from "./contextRetrieval";

export { AVAILABLE_MODELS, MODEL_ID };
export const BUSINESS_DOC_PATH = "docs/negocio.txt";
export const FALLBACK_REPLY =
  "Por el momento no tengo esa información, pero con gusto puedo ayudarle con otra consulta sobre Cafe Central.";

/**
 * Fallback contextual: cuando el modelo no encuentra un dato, devolvemos un
 * mensaje que (a) admite la limitación, (b) sugiere temas reales del
 * negocio (horario, menú, ubicación, reservas, contacto) y (c) cierra con
 * pregunta útil. Usa datos del JSON si están disponibles, si no cae a un
 * genérico.
 *
 * Por qué no solo `FALLBACK_REPLY`: ese string es estático y no le dice
 * al cliente qué puede preguntar. El nuevo fallback actúa como menú
 * improvisado — mejor UX que un "lo siento" seco, y mata la alucinación
 * de "no puedo proporcionar información sobre..." que tenía el modelo.
 */
export function buildFallbackReply(businessInfo) {
  const data = tryParseBusinessData(businessInfo);
  if (!data) return FALLBACK_REPLY;

  const businessName = data.local?.nombre ?? "el local";
  const hasHorarios = Boolean(data.horarios?.regular);
  const hasMenu = Boolean(data.menu?.categorias);
  const hasUbicacion = Array.isArray(data.sucursales) && data.sucursales.length > 0;
  const hasReservas = Boolean(data.servicios?.reservas);
  const telefono = data.local?.telefono;

  const temas = [];
  if (hasHorarios) temas.push("horarios");
  if (hasMenu) temas.push("el menú");
  if (hasUbicacion) temas.push("la ubicación");
  if (hasReservas) temas.push("reservas");

  if (temas.length === 0) return FALLBACK_REPLY;

  const temasStr = temas.length === 1
    ? temas[0]
    : temas.slice(0, -1).join(", ") + " o " + temas[temas.length - 1];

  const contacto = telefono ? ` Si necesitás algo urgente, llamános al ${telefono}.` : "";
  return `No tengo ese dato cargado, pero te puedo ayudar con ${temasStr}.${contacto} ¿Qué te interesa?`;
}

export const SUGGESTED_QUESTIONS = [
  "¿Cuál es el horario?",
  "¿Dónde están ubicados?",
  "¿Cuál es el teléfono?",
  "¿Cómo se puede pagar?",
  "¿Qué promociones tienen?",
];

export const DEFAULT_ASSISTANT_NAME = "Martín";

/**
 * Detecta el idioma aproximado de un mensaje del cliente. Se usa para que el
 * asistente responda en el mismo idioma en que le hablan (un cliente que
 * escribe en inglés recibe la respuesta en inglés, etc.) sin necesidad de
 * cargar prompts bilingües completos.
 *
 * Implementación intencionalmente simple: si la mayoría de los caracteres
 * alfabéticos son del alfabeto latino "básico" (sin tildes/ñ) y aparecen
 * palabras Stop típicas del inglés, devuelve "en"; si hay tildes/ñ o
 * stopwords claras del español, "es". Para otros casos cae a "es" porque
 * el público primario es hispanohablante.
 */
export function detectCustomerLanguage(text = "") {
  const t = (text || "").trim();
  if (!t) return "es";

  // Stopwords para detección rápida.
  const ES_STOP = /\b(hola|buenas|cómo|cuál|cuáles|cuándo|dónde|gracias|por favor|qué|quién|necesito|quiero|tienen|tenés|teneis|hay|está|están)\b/i;
  const EN_STOP = /\b(hello|hi|hey|how|what|when|where|thanks|please|do you|is there|are there|i need|i want|do you have)\b/i;

  if (EN_STOP.test(t) && !ES_STOP.test(t)) return "en";
  return "es";
}

/**
 * Build the assistant's system prompt dynamically. Compact by design: every
 * line is a hard rule, no flavor. Target: ~30-50 tokens so the system prompt
 * leaves most of the context window for the business data + history.
 *
 * Rules (in order, all binding):
 *  1. Identity: name is {name}, no other.
 *  2. Tone: rioplatense, brief, proactive.
 *  3. Data source: ONLY the "Información del negocio" block.
 *  4. If missing data: say so, suggest contact channel.
 *  5. Two-step answers: "ya te averiguo" + follow-up in same turn.
 *  6. Out-of-scope: redirect.
 *  7. Format: no prefixes, no quotes.
 */
export function buildSystemPrompt(assistantName = DEFAULT_ASSISTANT_NAME) {
  const name = (assistantName || DEFAULT_ASSISTANT_NAME).trim() || DEFAULT_ASSISTANT_NAME;
  return [
    `# Identidad`,
    `Sos ${name}, el asistente virtual del local.`,
    `Si te preguntan tu nombre: "Me llamo ${name}". Si te preguntan qué sos: "${name}, el asistente del local, estoy para ayudarte con lo que necesites."`,
    ``,
    `# Tono`,
    `Español rioplatense, voseo ("tenés", "querés", "decime"). Cálido, amable, proactivo. Respuestas de 1-2 frases, máximo un párrafo corto. Cerrá con UNA pregunta útil solo si ayuda a continuar.`,
    ``,
    `# Datos del negocio`,
    `Tu ÚNICA fuente de información es el bloque «Información del negocio» que aparece abajo. Regla: lo que NO esté en ese bloque, NO existe. NO inventes, NO completes con tu conocimiento previo, NO mezcles campos no relacionados con la pregunta.`,
    `Si el dato no está: respondé "No tengo ese dato cargado, te recomiendo consultar en el local" y, si el bloque tiene un canal (teléfono, WhatsApp, Instagram), mencionalo.`,
    `Si necesitás chequear algo: primero un mensaje breve tipo "ya te averiguo" o "déjame confirmar", y LUEGO, en el mismo turno, seguí con la información concreta. No esperes a que el cliente vuelva a escribir.`,
    ``,
    `# Cliente identificado`,
    `Si en el mensaje del cliente viene marcado «Cliente (registrado como: NOMBRE)», ese es su nombre. Usalo para personalizar la respuesta cuando sea natural (ej: «De nada, NOMBRE», «¿Querés que te reserve, NOMBRE?»). NO repitas su nombre en cada respuesta, usalo solo si suma calidez. NO vuelvas a preguntarle el nombre. NO digas «Me llamo [X]» salvo que él te pregunte tu nombre.`,
    ``,
    `# Formato`,
    `Sin prefijos ("Respuesta:", "Bot:"). Sin comillas envolviendo tu respuesta. Sin etiquetas meta. Una respuesta por turno, salvo el caso de "dos pasos" descrito arriba.`,
    ``,
    `# Precios`,
    `Cuando menciones un precio, usá SIEMPRE el formato "$1.500" (signo pesos adelante, separador de miles con punto, sin espacios). Ejemplos: $1.500, $3.200, $7.800. Si el dato trae decimales, no los inventes — usá el número entero tal como aparece en «Información del negocio».`,
    ``,
    `# Fuera de scope`,
    `Si el cliente pregunta algo que NO es del negocio (matemática, código, política, etc.): redirigí amablemente, ej: "Eso no es lo mío, pero si te puedo ayudar con algo del local, decime."`,
  ].join("\n");
}

// Back-compat: callers that imported SYSTEM_PROMPT directly still get a
// sensible default. New code should use buildSystemPrompt(config.assistantName).
export const SYSTEM_PROMPT = buildSystemPrompt(DEFAULT_ASSISTANT_NAME);

/**
 * Decide la próxima pregunta del flujo de intake (el "chitchat" que el bot
 * tiene con el cliente mientras el modelo de IA carga en segundo plano).
 *
 * Es lógica pura, NO usa el modelo: devuelve un objeto con la pregunta
 * a hacer y un campo para que el caller sepa qué tipo de dato está pidiendo,
 * o `null` cuando ya está todo y hay que esperar a que el cliente escriba
 * su consulta real.
 *
 * @param {object} state - Estado actual del intake.
 * @param {string} [state.name]              - Nombre del cliente (si ya se presentó).
 * @param {string} [state.topic]             - Motivo de consulta en una frase.
 * @param {string} [state.questionAsked]     - "name" | "topic" | "clarify" | null.
 * @param {string} [state.clarifyHint]       - Sugerencia para pregunta de clarificación.
 * @param {string} [assistantName]           - Nombre del asistente (para personalizar).
 * @param {string} [businessName]            - Nombre del local (para personalizar).
 * @returns {{ kind: string, text: string } | null}
 */
export function buildIntakeNextStep(
  state = {},
  assistantName = DEFAULT_ASSISTANT_NAME,
  businessName = ""
) {
  const name = (assistantName || DEFAULT_ASSISTANT_NAME).trim() || DEFAULT_ASSISTANT_NAME;
  const biz = (businessName || "").trim();
  const where = biz ? ` de ${biz}` : "";

  // 1) Saludo inicial con pregunta de nombre.
  if (!state.questionAsked) {
    return {
      kind: "greeting",
      text: `¡Hola! Soy ${name}${where}. ¿Cómo te llamás?`,
    };
  }

  // 2) Si ya preguntamos el nombre pero no lo tenemos todavía, esperar (el
  //    cliente tiene que contestar).
  if (state.questionAsked === "greeting" && !state.name) {
    return null;
  }

  // 3) Ya tenemos el nombre. Si no preguntamos el motivo, preguntarlo
  //    usando el nombre para personalizar (calidez).
  if (state.name && state.questionAsked !== "topic" && state.questionAsked !== "clarify") {
    return {
      kind: "topic",
      text: `Encantado, ${state.name}. ¿En qué te puedo ayudar hoy?`,
    };
  }

  // 4) Esperamos la respuesta al motivo.
  if (state.questionAsked === "topic" && !state.topic) {
    return null;
  }

  // 5) Si el motivo es muy corto o ambiguo, una clarificación. Esto sólo
  //    aplica una vez (el caller pone `questionAsked: "clarify"` para que
  //    no entre en loop).
  if (state.name && state.topic && state.questionAsked !== "clarify") {
    const t = (state.topic || "").trim();
    if (t.split(/\s+/).length <= 2) {
      return {
        kind: "clarify",
        text: `Contame un poco más así te ayudo mejor, ${state.name}.`,
      };
    }
  }

  // 6) Tenemos nombre + motivo claro → esperamos a que el cliente escriba
  //    su consulta o siga hablando.
  return null;
}

export const DEFAULT_CONFIG = {
  modelId: MODEL_ID,
  fallbackModelIds: DEFAULT_FALLBACK_MODEL_IDS,
  assistantName: DEFAULT_ASSISTANT_NAME,
  systemPrompt: SYSTEM_PROMPT,
  temperature: 0.05,
  topP: 0.85,
  maxTokens: 160,
  repetitionPenalty: 1.1,
  contextWindowSize: 4096,
  businessInfo: "",
  additionalContexts: [], // [{ name: string, content: string }, ...]
  dynamicSources: [], // [{ name, endpoint, enabled }]
};

/**
 * Validate and normalize dynamic API source definitions.
 */
export function normalizeDynamicSources(sources = []) {
  if (!Array.isArray(sources)) return [];

  return sources
    .filter((source) => source && typeof source === "object")
    .map((source) => ({
      name: String(source.name || "Fuente en tiempo real").trim() || "Fuente en tiempo real",
      endpoint: String(source.endpoint || "").trim(),
      enabled: source.enabled !== false,
    }))
    .filter((source) => source.enabled && source.endpoint);
}

/**
 * Convert arbitrary API payload into compact JSON text with metadata for prompting.
 */
export function toDynamicContext(sourceName, payload) {
  const isObject = payload && typeof payload === "object" && !Array.isArray(payload);
  const updatedAt = isObject && payload.updated_at ? String(payload.updated_at) : null;

  return {
    name: `${sourceName}${updatedAt ? ` (actualizado: ${updatedAt})` : ""}`,
    content: JSON.stringify(payload),
  };
}

/**
 * Fetch real-time JSON contexts from configured APIs.
 */
export async function fetchDynamicContexts(sources, fetchImpl = fetch) {
  const normalized = normalizeDynamicSources(sources);
  if (!normalized.length) {
    return { contexts: [], errors: [] };
  }

  const results = await Promise.all(
    normalized.map(async (source) => {
      try {
        const response = await fetchImpl(source.endpoint, {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          return {
            ok: false,
            name: source.name,
            error: `HTTP ${response.status}`,
          };
        }

        const payload = await response.json();
        return {
          ok: true,
          context: toDynamicContext(source.name, payload),
        };
      } catch (error) {
        return {
          ok: false,
          name: source.name,
          error: error instanceof Error ? error.message : "Error desconocido",
        };
      }
    })
  );

  return {
    contexts: results.filter((r) => r.ok).map((r) => r.context),
    errors: results.filter((r) => !r.ok).map((r) => ({ name: r.name, error: r.error })),
  };
}

/**
 * Estimate token count using character-based approximation.
 * Average: ~1 token per 4 characters for Spanish.
 */
export function estimateTokens(text) {
  if (!text) return 0;
  // Spanish typically has ~0.25 tokens per character
  return Math.ceil(text.length / 4);
}

/**
 * Calculate total tokens for all contexts and messages.
 */
export function calculateContextTokens({ businessInfo = "", chatHistory = "", additionalContexts = [] }) {
  let total = 0;
  if (businessInfo) total += estimateTokens(businessInfo);
  if (chatHistory) total += estimateTokens(chatHistory);
  for (const ctx of additionalContexts) {
    if (ctx.content) total += estimateTokens(ctx.content);
  }
  return total;
}

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Devuelve el bloque «Información actual» que se inyecta en cada turno para
 * que el modelo pueda responder preguntas relativas a fecha/hora («abren
 * hoy?», «qué día es», «hasta qué hora están»). Compacto: ~25-35 tokens.
 *
 * Acepta una fecha inyectable para que los tests no dependan del reloj.
 */
export function getCurrentContextInfo(now = new Date(), timeZone = undefined) {
  // Usamos Intl con timeZone del cliente si está disponible; el navegador lo
  // expone vía Intl.DateTimeFormat().resolvedOptions().timeZone.
  const formatter = new Intl.DateTimeFormat("es-AR", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  const weekday = (lookup.weekday || "").toLowerCase();
  const day = parseInt(lookup.day, 10) || now.getDate();
  const monthName = (lookup.month || "").toLowerCase();
  const year = lookup.year || String(now.getFullYear());
  const hour = parseInt(lookup.hour, 10) || 0;
  const minute = parseInt(lookup.minute, 10) || 0;

  const hora = `${pad2(hour)}:${pad2(minute)}`;
  const fecha = `${day} de ${monthName} de ${year}`;

  return {
    fecha,
    hora,
    dia_semana: weekday,
    es_fin_de_semana: weekday === "sábado" || weekday === "domingo",
    zona_horaria: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
  };
}

/**
 * Token budget available for the business-info block, given everything else
 * that must fit in the model window (system prompt, history, extra contexts,
 * the question itself and the reserved response).
 */
export function computeBusinessInfoBudget({
  contextWindowSize = DEFAULT_CONFIG.contextWindowSize,
  systemPrompt = SYSTEM_PROMPT,
  chatHistory = "",
  additionalContexts = [],
  question = "",
  maxTokens = DEFAULT_CONFIG.maxTokens,
} = {}) {
  const fixedTokens =
    estimateTokens(systemPrompt) +
    estimateTokens(chatHistory) +
    additionalContexts.reduce((sum, ctx) => sum + estimateTokens(ctx.content || ""), 0) +
    estimateTokens(question) +
    maxTokens + // potential response
    80; // structural overhead

  return Math.max(250, contextWindowSize - fixedTokens);
}

export function buildMessages({
  businessInfo,
  question,
  systemPrompt = SYSTEM_PROMPT,
  chatHistory = "",
  additionalContexts = [],
  contextWindowSize = DEFAULT_CONFIG.contextWindowSize,
  maxTokens = DEFAULT_CONFIG.maxTokens,
  now = new Date(),
  clientTimeZone,
  customerName,
}) {
  // Send only the sections of the business document relevant to this question,
  // within the available token budget (RAG-lite, see contextRetrieval.js).
  const infoBudget = computeBusinessInfoBudget({
    contextWindowSize,
    systemPrompt,
    chatHistory,
    additionalContexts,
    question,
    maxTokens,
  });
  const compactInfo = selectRelevantBusinessInfo(businessInfo, question, infoBudget);

  // Bloque de fecha/hora del cliente: ~25-35 tokens, lo usa el modelo para
  // preguntas relativas a «hoy», «ahora», «qué día», etc.
  const ahora = getCurrentContextInfo(now, clientTimeZone);

  // Estructura del user content (orden importa: el modelo presta más atención
  // al inicio y al final del mensaje — datos del negocio al principio para
  // anclar el contexto, pregunta del cliente al final para enfocar la
  // respuesta).
  const parts = [];

  // 1. Datos del negocio (RAG-lite: solo secciones relevantes). Esto es lo
  //    que el modelo tiene que usar como única fuente de verdad.
  parts.push(
    `Información del negocio (ÚNICA fuente de datos — no inventes nada que no esté acá):\n${compactInfo || "(sin datos del negocio cargados)"}`
  );

  // 2. Información actual (fecha/hora del cliente).
  parts.push(
    `Información actual: hoy es ${ahora.dia_semana} ${ahora.fecha}, hora ${ahora.hora} (${ahora.zona_horaria})${ahora.es_fin_de_semana ? ", fin de semana" : ""}.`
  );

  // 2b. Idioma del cliente. Una sola línea, sólo si NO es español (el
  // system prompt ya asume español por default). Le dice al modelo: si el
  // cliente escribió en otro idioma, respondé en ese idioma. Mantiene
  // bilingüe sin cargar dos prompts.
  const lang = detectCustomerLanguage(question);
  if (lang !== "es") {
    parts.push(`Idioma: el cliente escribió en ${lang === "en" ? "inglés" : lang}. Respondé en ese mismo idioma.`);
  }

  // 3. Contextos adicionales (si hay).
  for (const ctx of additionalContexts) {
    if (ctx.content?.trim()) {
      let compactCtx = ctx.content.trim();
      try {
        compactCtx = JSON.stringify(JSON.parse(compactCtx));
      } catch {
        // plain-text — use as-is
      }
      parts.push(`Contexto: ${ctx.name}\n${compactCtx}`);
    }
  }

  // 4. Historial de la conversación.
  if (chatHistory.trim()) {
    parts.push(`Historial de conversación:\n${chatHistory}`);
  }

  // 5. Pregunta del cliente al final — el modelo la lee con la "atención
  //    fresca" y la usa para focalizar la respuesta. Si tenemos el nombre
  //    del cliente registrado, lo marcamos acá para que el system prompt
  //    pueda personalizar la respuesta sin que el modelo tenga que adivinar.
  const name = (customerName || "").trim();
  const questionLine = name
    ? `Pregunta del cliente (registrado como: ${name}): ${question.trim()}`
    : `Pregunta del cliente: ${question.trim()}`;
  parts.push(questionLine);

  const userContent = parts.join("\n\n");
  
  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: userContent,
    },
  ];
}

/**
 * Extrae el nombre del cliente de un mensaje. Devuelve `null` si no
 * detecta una presentación clara. Usado para que la app recuerde el
 * nombre en estado conversacional y lo inyecte en prompts siguientes.
 *
 * Acepta frases tipo "me llamo X", "soy X", "mi nombre es X", "llamame X".
 * Devuelve solo el primer nombre (capitalizado) y descarta palabras
 * adicionales para no romper la personalización con saludos largos.
 */
export function extractCustomerName(text = "") {
  if (!text) return null;
  const match = text.match(
    /(?:me llamo|soy|mi nombre es|llamame|llamáme|me dicen)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,20})/i
  );
  if (!match) return null;
  return match[1];
}

/**
 * Light sanitization for partial text while it streams: strips special tokens
 * and cuts at prompt-echo markers, but never substitutes the fallback reply —
 * the full sanitizeAssistantReply runs once streaming finishes.
 */
export function sanitizeStreamingText(rawText) {
  if (!rawText || typeof rawText !== "string") return "";

  let text = rawText.replace(/<\|[^>]*\|>/g, "");

  const stopMarkers = [
    /\nInformaci[oó]n del negocio\s*:/i,
    /\nPregunta\s*:/i,
    /\nCliente\s*:/i,
    /\nContexto del negocio\s*:/i,
    /\nRespuesta breve\s*:/i,
  ];

  for (const marker of stopMarkers) {
    const match = text.match(marker);
    if (match && typeof match.index === "number") {
      text = text.slice(0, match.index);
    }
  }

  return text.trimStart();
}

export function sanitizeAssistantReply(rawReply, businessInfo = "") {
  // Fallback contextual si hay businessInfo (PR2.C), si no el estático
  // para mantener compat con callers/tests viejos.
  const fallback = businessInfo ? buildFallbackReply(businessInfo) : FALLBACK_REPLY;

  if (!rawReply || typeof rawReply !== "string") {
    return fallback;
  }

  let sanitized = rawReply.trim();

  sanitized = sanitized.replace(/<\|[^>]+\|>/g, " ").trim();

  const stopMarkers = [
    /\nInformaci[oó]n del negocio\s*:/i,
    /\nPregunta\s*:/i,
    /\nCliente\s*:/i,
    /\nContexto del negocio\s*:/i,
    /\nRespuesta breve\s*:/i,
  ];

  for (const marker of stopMarkers) {
    const match = sanitized.match(marker);
    if (match && typeof match.index === "number") {
      sanitized = sanitized.slice(0, match.index).trim();
    }
  }

  const labeledAnswerMatch = sanitized.match(
    /(?:^|\n)\s*respuesta(?:\s+(?:final|breve))?\s*:\s*([\s\S]*)/i
  );
  if (labeledAnswerMatch?.[1]) sanitized = labeledAnswerMatch[1].trim();

  sanitized = sanitized
    .split(/\n{2,}/)
    .map((c) => c.trim())
    .filter(Boolean)
    .filter(
      (c) =>
        !/^(respuesta(?:\s+\w+)?|pregunta|consulta|contexto del negocio|informaci[oó]n del negocio)\s*:/i.test(c)
    )
    .join("\n\n")
    .trim();

  const seen = new Set();
  sanitized = sanitized
    .split("\n")
    .filter((line) => {
      const key = line.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n")
    .trim();

  if (!sanitized) {
    return fallback;
  }

  if (
    /^(sí|si)\s*,?\s*si la respuesta no está en la información disponible/i.test(sanitized) ||
    /^no se dispone de esa información\.?$/i.test(sanitized) ||
    /^no tengo esa información\.?$/i.test(sanitized) ||
    // Patrones adicionales que produce TinyLlama cuando se traba (PR2.C):
    // «Lo siento, pero no puedo proporcionar información sobre...»,
    // «No puedo ayudar con eso...», «No tengo acceso a...».
    /^lo siento,?\s+pero\s+no\s+(puedo|dispongo|cuento\s+con)/i.test(sanitized) ||
    /^no\s+puedo\s+(proporcionar|brindar|dar|ayudar)/i.test(sanitized) ||
    /^no\s+(tengo|cuento\s+con)\s+(acceso|informaci[oó]n)\s+(a|sobre)/i.test(sanitized)
  ) {
    return fallback;
  }

  return sanitized;
}

export async function loadBusinessDocument(fetchImpl = fetch, basePath = import.meta.env.BASE_URL) {
  const response = await fetchImpl(`${basePath}${BUSINESS_DOC_PATH}`);

  if (!response.ok) {
    throw new Error("No se pudo cargar la información del negocio.");
  }

  return response.text();
}

export async function loadModelRuntimeModule(modelId) {
  const model = getModelById(modelId);
  if (!model) {
    throw new Error(`Modelo no soportado: ${modelId}`);
  }

  if (model.runtime === "webllm") {
    return import("@mlc-ai/web-llm");
  }

  if (model.runtime === "transformers") {
    return null;
  }

  throw new Error(`Runtime no soportado: ${model.runtime}`);
}

function createSingleChunkStream(text) {
  return (async function* stream() {
    yield {
      choices: [{ delta: { content: text } }],
    };
  })();
}

function createWorkerRpc(worker) {
  let nextRequestId = 1;
  const pendingRequests = new Map();

  worker.onmessage = (event) => {
    const { id, type, payload } = event.data || {};
    if (!pendingRequests.has(id)) return;

    const request = pendingRequests.get(id);

    if (type === "progress") {
      request.onProgress?.(payload);
      return;
    }

    pendingRequests.delete(id);

    if (type === "result") {
      request.resolve(payload);
      return;
    }

    if (type === "error") {
      request.reject(new Error(payload?.message || "Error desconocido en el worker."));
    }
  };

  return function callWorker(type, payload, onProgress) {
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject, onProgress });
      worker.postMessage({ id, type, payload });
    });
  };
}

async function createTransformersEngine(onProgress, { modelId = MODEL_ID, preferredBackend = "wasm" } = {}) {
  const model = getModelById(modelId);
  if (!model) {
    throw new Error(`Modelo no soportado: ${modelId}`);
  }

  const worker = new Worker(new URL("./transformersEngineWorker.js", import.meta.url), {
    type: "module",
  });
  const callWorker = createWorkerRpc(worker);

  const loadResult = await callWorker(
    "load",
    { modelId, preferredBackend },
    (progress) => {
      onProgress?.({
        ...progress,
        text:
          progress?.progress === 1
            ? `${model.label} listo.`
            : `Cargando ${model.label} en ${getRuntimeLabel(model.runtime)}...`,
      });
    }
  );

  const backend = loadResult?.backend || preferredBackend;

  const engine = {
    runtime: model.runtime,
    backend,
    modelId,
    providerModelId: model.providerModelId,
    worker,
    unload: async () => {
      try {
        await callWorker("unload", {});
      } finally {
        worker.terminate();
      }
    },
    interruptGenerate: async () => {
      await callWorker("interrupt", {});
    },
  };

  engine.chat = {
    completions: {
      create: async ({ stream = false, ...payload }) => {
        const result = await callWorker("generate", payload);

        if (stream) {
          return createSingleChunkStream(result.text || "");
        }

        return {
          choices: [{ message: { content: result.text || "" } }],
        };
      },
    },
  };

  return engine;
}

export async function createEngine(
  runtimeModule,
  onProgress,
  { modelId = MODEL_ID, contextWindowSize = 4096, preferredBackend } = {}
) {
  const model = getModelById(modelId);
  if (!model) {
    throw new Error(`Modelo no soportado: ${modelId}`);
  }

  if (model.runtime === "webllm") {
    return runtimeModule.CreateMLCEngine(
      model.providerModelId,
      { initProgressCallback: onProgress, logLevel: "WARN" },
      { context_window_size: contextWindowSize }
    );
  }

  if (model.runtime === "transformers") {
    return createTransformersEngine(onProgress, { modelId, preferredBackend });
  }

  throw new Error(`Runtime no soportado: ${model.runtime}`);
}

/**
 * Instant keyword-based lookup on the business JSON document.
 * Returns an answer string for common topics, or null if the model is needed.
 *
 * @param {string} businessInfo
 * @param {string} question
 * @param {object} [options]
 * @param {string} [options.assistantName] - Used in the greeting fallback when
 *   the business JSON doesn't define `local.nombre`. Defaults to "Martín".
 */
export function quickLookup(businessInfo, question, options = {}) {
  const { assistantName = DEFAULT_ASSISTANT_NAME } = options;
  if (!businessInfo) return null;

  let data;
  try {
    data = JSON.parse(businessInfo);
  } catch {
    return null; // not JSON — let the model handle it
  }

  const q = question
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // ---- Recomendaciones por día: «qué día conviene venir», «cuándo hay menos gente»
  if (/convien|menos gente|tranquilo|sin gente|mejor dia|cuando ir/.test(q)) {
    const recs = data.recomendaciones_por_dia;
    if (!recs) return null;
    const lines = Object.entries(recs).map(([day, txt]) => `${day}: ${txt}`);
    return lines.join("\n");
  }

  if (/horario|abre|cierra|cuando|lunes|viernes|sabado|domingo|manana|tarde/.test(q)) {
    const regular = data.horarios?.regular;
    if (!regular) return null;
    const lines = Object.entries(regular).map(([day, hours]) => `${day}: ${hours}`);
    if (data.horarios.cocina_cierra) lines.push(`Cocina: ${data.horarios.cocina_cierra}`);
    // Sumar días especiales si existen.
    if (Array.isArray(data.horarios.especiales) && data.horarios.especiales.length) {
      for (const esp of data.horarios.especiales) {
        lines.push(`${esp.fecha} (${esp.motivo}): ${esp.horario}`);
      }
    }
    return lines.join("\n");
  }
  if (/direcci|donde|ubicaci|calle|domicilio|llegar/.test(q)) {
    const suc = data.sucursales;
    if (!suc?.length) return null;
    return suc.map((s) => `${s.nombre}: ${s.direccion} (${s.barrio ?? ""})`).join("\n");
  }
  if (/telefon|numero|contacto|llamar|whatsapp/.test(q)) {
    return data.local?.telefono ?? null;
  }
  if (/pago|pagar|efectivo|tarjeta|credito|debito|mercadopago|transferencia/.test(q)) {
    const medios = data.servicios?.medios_de_pago;
    if (!medios?.length) return null;
    return medios.join(", ");
  }
  if (/promoci|descuento|oferta|promo/.test(q)) {
    // Deterministic answer: small models tend to invent promotions when the
    // document has none, so this topic never reaches the model.
    const promos = data.promociones;
    if (Array.isArray(promos) && promos.length) {
      return promos
        .map((p) => (typeof p === "string" ? p : `${p.nombre ?? p.titulo ?? "Promo"}: ${p.descripcion ?? p.detalle ?? ""}`.trim()))
        .join("\n");
    }
    const instagram = data.local?.redes_sociales?.instagram;
    return `Por el momento no tengo promociones cargadas. Te recomendamos consultar en el local${
      instagram ? ` o en nuestro Instagram (${instagram})` : ""
    }.`;
  }
  // Cancelación se chequea ANTES que reservas: «¿cómo cancelo una reserva?»
  // matchea ambas, pero la política es más útil que el genérico. El regex
  // cubre conjugaciones: cancelar, cancelo, cancelás, cancelación.
  if (/cancelaci[oó]n|cancelar|cancel\w{1,3}/.test(q)) {
    return data.local?.politicas?.cancelacion_reservas ?? null;
  }
  if (/reserva/.test(q)) {
    if (!data.servicios?.reservas) return null;
    const faq = data.faq?.find((f) => /reserva/i.test(f.pregunta));
    const canal = data.servicios?.reservas_canal ? ` Podés reservar por ${data.servicios.reservas_canal}.` : "";
    return (faq?.respuesta ?? "Sí, aceptamos reservas desde el sitio web o por teléfono.") + canal;
  }
  if (/mascota|perro|gato|pet/.test(q)) {
    const hasPet = data.sucursales?.some((s) => s.pet_friendly);
    const nota = data.local?.politicas?.mascotas;
    if (!hasPet && !nota) return null;
    return [hasPet ? "Sí, somos pet friendly en las mesas del exterior." : null, nota].filter(Boolean).join(" ");
  }
  if (/wifi|internet|clave|contrasena|contraseña|password/.test(q)) {
    const w = data.local?.wifi ?? (data.servicios?.wifi ? { disponible: true } : null);
    if (!w?.disponible) return null;
    if (w.red && w.password) {
      return `Sí: red "${w.red}", contraseña "${w.password}".${w.nota ? ` ${w.nota}` : ""}`;
    }
    return "Sí, contamos con WiFi disponible en todas las sucursales.";
  }
  if (/delivery|domicilio|envio/.test(q)) {
    if (!data.servicios?.delivery) return null;
    return data.servicios.delivery_cobertura
      ? `Sí, realizamos delivery. ${data.servicios.delivery_cobertura}`
      : "Sí, realizamos delivery.";
  }
  if (/takeaway|para llevar|llevar/.test(q)) {
    return data.servicios?.takeaway ? "Sí, tenemos servicio de takeaway (para llevar)." : null;
  }
  if (/cocina|ultima orden|ultima hora|ultima pedido/.test(q)) {
    return data.horarios?.cocina_cierra
      ? `La cocina cierra ${data.horarios.cocina_cierra}.`
      : null;
  }
  if (/factura|facturacion|facturar/.test(q)) {
    return data.local?.politicas?.facturacion ?? null;
  }
  if (/vegetarian|vegano|sin gluten|celiac|leche vegetal/.test(q)) {
    const d = data.dietas_y_opciones;
    if (!d) return null;
    const opts = [];
    if (d.vegetariano) opts.push("opciones vegetarianas");
    if (d.vegano) opts.push("opciones veganas");
    if (d.sin_gluten) opts.push("sin gluten");
    const leche = d.leche_vegetal ?? d.leche_vegetal_disponible;
    if (leche?.length) opts.push(`leche vegetal (${leche.join(", ")})`);
    return opts.length ? `Sí, contamos con: ${opts.join(", ")}.` : null;
  }
  // Destacados del menú: match cuando piden recomendación genérica de
  // comida. NO matchear «qué día conviene» (eso lo cubre
  // recomendaciones_por_dia). La idea: si dicen «recomendá» sin más,
  // devolvemos destacados del menú; si dicen «qué día conviene», mostramos
  // recomendaciones por día. Priorizamos destacados para no devolver
  // info genérica cuando el cliente probablemente quiere un plato.
  if (
    /destacad|mas pedido|mas popular|signature|plato recomend|recomend.*(comida|plato|cafe|menu|para comer|para tomar)/.test(q) ||
    (/recomend/.test(q) && !/dia|venir|ir|menos gente|tranquilo/.test(q))
  ) {
    const d = data.menu?.destacados;
    if (!Array.isArray(d) || !d.length) return null;
    const sym = data.metadata?.simbolo_moneda ?? "";
    return d.map((p) => `${p.nombre}: ${sym}${p.precio.toLocaleString("es")}`).join("\n");
  }
  if (/menu|carta/.test(q)) {
    const cats = data.menu?.categorias;
    if (!cats) return null;
    return Object.keys(cats).join(", ");
  }
  if (/nombre|que es|que hacen|dedica|descripci|cafeteria|quienes son/.test(q)) {
    return data.local?.descripcion ?? null;
  }
  if (/hola|buenas|buen[oa]s|salud/.test(q)) {
    const businessName = data.local?.nombre ?? "Cafe Central";
    return `¡Hola! Soy ${assistantName}, del equipo de ${businessName}. ¿En qué te puedo ayudar?`;
  }
  return null;
}

/**
 * Intenciones de negocio que la app reconoce. Se usan para dos cosas:
 *  1) Decidir si `quickLookup` puede responder sin modelo.
 *  2) Decidir qué repregunta proactiva agregar al final de la respuesta
 *     del modelo cuando el modelo no haya cerrado con una pregunta útil
 *     (los modelos chicos, ej. TinyLlama 1.1B, suelen olvidarse).
 *
 * Una sola fuente de verdad: la lista y el orden de los regex debe
 * matchear con la implementación real. Si agregás una intención nueva,
 * agregá también una rama en `buildFollowUp` y un test.
 */
const INTENT_PATTERNS = [
  // Orden importa: precio antes que menu (porque el regex de menu incluye
  // palabras como "cafe" o "medialuna" que pueden matchear junto con
  // "cuanto"). Si la pregunta tiene keywords de precio, gana precio.
  ["precio", /precio|cuesta|vale|sale|cuanto|cu[aá]nto|valor|tarifa/],
  ["menu", /menu|carta|plato|comida|comer|que tienen|que hay para|cafe|brunch|almuerzo|desayun|merienda|postre|torta|medialuna|tostado|sandwich|jugo|bebida|cerveza|vino|destacad|recomend.*(comida|plato|cafe|menu|para comer|para tomar)/],
  ["promo", /promoci|descuento|oferta|promo/],
  ["horario", /horario|abre|cierra|cuando|lunes|viernes|sabado|domingo|manana|tarde|hoy|ahora/],
  ["ubicacion", /direcci|donde|ubicaci|calle|barrio|llegar|mapa|sucursal|zona/],
  ["contacto", /telefon|numero|contacto|llamar|whatsapp|mail|email/],
  ["pago", /pago|pagar|efectivo|tarjeta|credito|debito|mercadopago|transferencia|qr/],
  ["reserva", /reserva|reservar|mesa|apartar/],
  ["mascota", /mascota|perro|gato|pet/],
  ["wifi", /wifi|internet|clave|contrasena|contraseña|password/],
  ["delivery", /delivery|domicilio|envio/],
  ["takeaway", /takeaway|para llevar|llevar/],
  ["cancelacion", /cancelaci[oó]n|cancelar|cancel\w{1,3}/],
  ["factura", /factura|facturacion|facturar/],
  ["dieta", /vegetarian|vegano|sin gluten|celiac|leche vegetal|almendra|soja/],
  ["cocina", /cocina|ultima orden|ultima hora|ultima pedido/],
  ["recomendacion_dia", /convien|menos gente|tranquilo|sin gente|mejor dia|cuando ir/],
  ["descripcion", /nombre|que es|que hacen|dedica|descripci|cafeteria|quienes son|historia/],
];

/**
 * Detecta la intención dominante de una pregunta. Devuelve `null` si no
 * matchea ninguna (en ese caso el modelo responde libre).
 *
 * `precio` se chequea antes que `menu` para que "cuanto sale el cafe" no se
 * confunda con "qué tienen en el menú". `reserva` antes que `mascota` por
 * la palabra "mesa" que aparece en reservas.
 */
export function detectIntent(question = "") {
  const q = (question || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(q)) return intent;
  }
  return null;
}

function tryParseBusinessData(businessInfo) {
  if (!businessInfo) return null;
  try {
    return JSON.parse(businessInfo);
  } catch {
    return null;
  }
}

/**
 * Parsea un string "HH:MM - HH:MM" (formato de negocio.txt) y devuelve
 * la hora de cierre como [HH, MM] en 24h, o null si no matchea.
 * Se usa para construir la repregunta "¿venís? estamos hasta las HH:MM".
 */
function parseClosingHour(hoursRange) {
  if (typeof hoursRange !== "string") return null;
  const match = hoursRange.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return [parseInt(match[3], 10), parseInt(match[4], 10)];
}

const DIAS_CORTO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/**
 * Devuelve la hora de cierre de HOY según el JSON del negocio, o null si
 * no se puede determinar (no hay horarios cargados o es un día especial
 * con horario custom). Usado para personalizar la repregunta de horario.
 */
function getTodayClosingTime(data, now) {
  const regular = data?.horarios?.regular;
  if (!regular) return null;
  const dayName = DIAS_CORTO[now.getDay()];
  const todayRange = regular[dayName];
  return parseClosingHour(todayRange);
}

function formatHour(h, m) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Construye una repregunta proactiva para una intención dada. Devuelve
 * `null` si no hay una buena repregunta para esa intención.
 *
 * Reglas:
 *  - 1 frase, máx ~120 chars, termina con "?" o "?"
 *  - Usa datos reales del JSON cuando aplica (ej: horario de cierre de hoy)
 *  - Personaliza con el nombre del cliente si está disponible
 *  - Sugiere siguiente paso útil: venir, reservar, mirar el menú, etc.
 *
 * @param {string} intent       - Intención detectada (ver INTENT_PATTERNS).
 * @param {string} businessInfo - JSON del negocio (puede ser texto plano).
 * @param {object} [options]
 * @param {string} [options.customerName]  - Nombre del cliente si ya se presentó.
 * @param {Date}   [options.now]           - Reloj para "hoy".
 * @returns {string|null}
 */
export function buildFollowUp(intent, businessInfo, options = {}) {
  const { customerName, now = new Date() } = options;
  const data = tryParseBusinessData(businessInfo);
  const name = (customerName || "").trim();
  const greet = name ? `, ${name}` : "";

  switch (intent) {
    case "horario": {
      const closing = data ? getTodayClosingTime(data, now) : null;
      const closingStr = closing ? ` hasta las ${formatHour(closing[0], closing[1])}` : "";
      return `¿Te interesa venir${greet}? Hoy estamos abiertos${closingStr}.${name ? "" : " Si me decís tu nombre, te lo confirmo con más detalle."}`;
    }
    case "precio":
    case "menu": {
      const sym = data?.metadata?.simbolo_moneda ?? "$";
      return `¿Querés que te pase el menú completo o tenés algo en mente?${name ? ` Decime, ${name}.` : ""}`;
    }
    case "promo": {
      const ig = data?.local?.redes_sociales?.instagram;
      return ig
        ? `¿Querés que te cuente las promos vigentes? Las actualizamos en Instagram (${ig}).`
        : `¿Querés que te cuente las promos vigentes?`;
    }
    case "ubicacion": {
      const first = data?.sucursales?.[0];
      if (first?.barrio) {
        return `¿Querés que te pase cómo llegar a la sucursal de ${first.barrio}?`;
      }
      return `¿Querés que te pase la dirección o cómo llegar?`;
    }
    case "contacto":
      return `¿Te sirve el teléfono o preferís que te derive por WhatsApp?`;
    case "pago":
      return `¿Vas a pagar en efectivo o con tarjeta? Así te confirmo los medios disponibles.`;
    case "reserva": {
      const canal = data?.servicios?.reservas_canal;
      return canal
        ? `¿Querés que te reserve? Lo podemos hacer por ${canal}.`
        : `¿Querés que te reserve?`;
    }
    case "mascota":
      return `¿Venís con mascota${greet}? Las mesas de exterior son pet friendly.`;
    case "wifi":
      return `¿Necesitás la clave del WiFi${greet}?`;
    case "delivery":
      return `¿Querés hacer un pedido o consultás la cobertura${greet}?`;
    case "takeaway":
      return `¿Pasás a retirar${greet}?`;
    case "cancelacion":
      return `¿Necesitás cancelar una reserva${greet}?`;
    case "factura":
      return `¿Necesitás factura A o B${greet}?`;
    case "dieta":
      return `¿Buscás algo específico${greet}?`;
    case "cocina":
      return `¿Querés saber qué hay disponible a esta hora${greet}?`;
    case "recomendacion_dia":
      return `¿Querés que te recomiende un día tranquilo${greet}?`;
    case "descripcion":
      return `¿Querés saber más del local${greet}?`;
    default:
      return null;
  }
}

/**
 * Heurística: ¿la respuesta del modelo YA cierra con una pregunta útil?
 * Si la respuesta es corta, sin signos de interrogación, o tiene un
 * "?" cerca del final, asumimos que ya repreguntó. Si no, devolvemos
 * `false` y `enhanceReplyWithFollowUp` agrega la plantilla.
 *
 * Modelos chicos (TinyLlama 1.1B) suelen olvidarse de cerrar con pregunta
 * aunque el system prompt se los pida; por eso este check es laxo (mejor
 * agregar una repregunta de más que quedarse corto).
 */
function replyAlreadyEndsWithQuestion(reply) {
  if (!reply) return false;
  const trimmed = reply.trim();
  if (!trimmed) return false;
  // Busca un "?" en los últimos 80 chars (cubre preguntas multilinea y
  // respuestas largas que terminan preguntando).
  const tail = trimmed.slice(-80);
  return /\?/.test(tail);
}

/**
 * Enriquece la respuesta del modelo con una repregunta proactiva, solo
 * si (a) la pregunta del cliente matchea una intención conocida, (b) la
 * respuesta del modelo no termina ya con una pregunta, y (c) hay una
 * plantilla disponible para esa intención.
 *
 * Si la respuesta del modelo ya es una pregunta, no la tocamos. Si la
 * intención no matchea, devolvemos la respuesta sin cambios.
 *
 * @param {string} reply        - Respuesta sanitizada del modelo.
 * @param {string} question     - Pregunta original del cliente.
 * @param {string} businessInfo - JSON del negocio.
 * @param {object} [options]
 * @param {string} [options.customerName]
 * @param {Date}   [options.now]
 * @returns {string} Reply con repregunta concatenada (o sin cambios).
 */
export function enhanceReplyWithFollowUp(reply, question, businessInfo, options = {}) {
  if (!reply) return reply;
  const intent = detectIntent(question);
  if (!intent) return reply;
  if (replyAlreadyEndsWithQuestion(reply)) return reply;
  const followUp = buildFollowUp(intent, businessInfo, options);
  if (!followUp) return reply;
  // Une con espacio. Si la respuesta original no termina en puntuación
  // fuerte, agregamos un "." antes de la repregunta para que se lea bien.
  const trimmed = reply.replace(/[\s]+$/, "");
  const needsPeriod = !/[.!?]$/.test(trimmed);
  return `${trimmed}${needsPeriod ? "." : ""} ${followUp}`;
}

export async function streamAssistantReply(engine, businessInfo, question, onToken, config = {}) {
  const {
    systemPrompt = SYSTEM_PROMPT,
    temperature = DEFAULT_CONFIG.temperature,
    topP = DEFAULT_CONFIG.topP,
    maxTokens = DEFAULT_CONFIG.maxTokens,
    repetitionPenalty = DEFAULT_CONFIG.repetitionPenalty,
    chatHistory = "",
    additionalContexts = [],
    contextWindowSize = DEFAULT_CONFIG.contextWindowSize,
    now,
    clientTimeZone,
  } = config;

  const stream = await engine.chat.completions.create({
    messages: buildMessages({ businessInfo, question, systemPrompt, chatHistory, additionalContexts, contextWindowSize, maxTokens, now, clientTimeZone }),
    stream: true,
    temperature,
    top_p: topP,
    repetition_penalty: repetitionPenalty,
    max_tokens: maxTokens,
  });

  let accumulated = "";
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || "";
    if (delta) {
      accumulated += delta;
      onToken(accumulated);
    }
  }
  return sanitizeAssistantReply(accumulated, businessInfo);
}

// Non-streaming variant kept for unit tests
export async function getAssistantReply(engine, businessInfo, question, config = {}) {
  const {
    systemPrompt = SYSTEM_PROMPT,
    temperature = DEFAULT_CONFIG.temperature,
    topP = DEFAULT_CONFIG.topP,
    maxTokens = DEFAULT_CONFIG.maxTokens,
    repetitionPenalty = DEFAULT_CONFIG.repetitionPenalty,
    chatHistory = "",
    additionalContexts = [],
    contextWindowSize = DEFAULT_CONFIG.contextWindowSize,
    now,
    clientTimeZone,
  } = config;

  const response = await engine.chat.completions.create({
    messages: buildMessages({ businessInfo, question, systemPrompt, chatHistory, additionalContexts, contextWindowSize, maxTokens, now, clientTimeZone }),
    temperature,
    top_p: topP,
    repetition_penalty: repetitionPenalty,
    max_tokens: maxTokens,
    stop: ["\nInformación del negocio:", "\nPregunta:", "\nCliente:"],
  });
  return sanitizeAssistantReply(response.choices?.[0]?.message?.content, businessInfo);
}

/**
 * Calculate total tokens used in current and potential response.
 */
export function calculateMessagesTokens({
  systemPrompt = SYSTEM_PROMPT,
  businessInfo = "",
  question = "",
  chatHistory = "",
  additionalContexts = [],
  responseLength = 0, // tokens in the response
  contextWindowSize = DEFAULT_CONFIG.contextWindowSize,
  now,
  clientTimeZone,
}) {
  const messages = buildMessages({
    businessInfo,
    question,
    systemPrompt,
    chatHistory,
    additionalContexts,
    contextWindowSize,
    maxTokens: responseLength || DEFAULT_CONFIG.maxTokens,
    now,
    clientTimeZone,
  });

  let totalTokens = 0;
  for (const msg of messages) {
    totalTokens += estimateTokens(msg.content);
  }

  return {
    contextTokens: totalTokens,
    responseTokens: responseLength,
    totalTokens: totalTokens + responseLength,
  };
}

/**
 * Extract key semantic facts from a single user message.
 * Returns an array of { type, value } objects.
 */
function extractMessageFacts(text) {
  const lower = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const facts = [];

  // Client name
  const nameMatch = text.match(
    /(?:me llamo|soy|mi nombre es|llamame)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,20})/i
  );
  if (nameMatch) facts.push({ type: "name", value: nameMatch[1] });

  // Explicit order / request
  const orderMatch = text.match(
    /(?:quiero|pido|dame|traeme|tráeme|quisiera|pedi|pedí|voy a pedir|me pones|me ponés|me traes|me traés|me das)\s+([^.!?\n]{3,40})/i
  );
  if (orderMatch) facts.push({ type: "order", value: orderMatch[1].trim() });

  // Food/drink items mentioned explicitly
  const itemRegex =
    /\b(caf[eé]|cortado|cappuccino|latte|medialunas?|tostado|s[aá]ndwich|jugo|agua|cerveza|vino|postre|torta|factura|croissant|submarino|t[eé])\b/gi;
  const items = text.match(itemRegex);
  if (items) {
    for (const item of new Set(items.map((i) => i.toLowerCase()))) {
      facts.push({ type: "item", value: item });
    }
  }

  // Topics consulted
  const topicPatterns = [
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
  for (const [pattern, topic] of topicPatterns) {
    if (pattern.test(lower)) facts.push({ type: "topic", value: topic });
  }

  return facts;
}

/**
 * Build a compact summary string from extracted conversation data.
 * @deprecated reemplazado por la lógica inline en generateChatSummary (rolling window).
 */
function buildSummaryText({ names, orders, topics, lastExchange }) {
  const lines = [];
  if (names.length > 0) lines.push(`Nombre del cliente: ${names.join(", ")}`);
  if (orders.length > 0) lines.push(`Pidió: ${orders.join(", ")}`);
  if (topics.length > 0) lines.push(`Consultó sobre: ${topics.join(", ")}`);

  let text = "";
  if (lines.length > 0) {
    text = `Contexto de la charla:\n${lines.map((l) => `- ${l}`).join("\n")}\n\n`;
  }
  text += `Última interacción:\n- Cliente: ${lastExchange.user}\n  Asistente: ${lastExchange.bot}`;
  return text;
}

/**
 * Compute the token budget available for conversation history, based on the
 * current config. Accounts for system prompt, business info, additional
 * contexts and the reserved response length.
 */
export function computeHistoryBudget(config = {}) {
  const {
    contextWindowSize = DEFAULT_CONFIG.contextWindowSize,
    systemPrompt = SYSTEM_PROMPT,
    businessInfo = "",
    additionalContexts = [],
    maxTokens = DEFAULT_CONFIG.maxTokens,
  } = config;

  const fixedTokens =
    estimateTokens(systemPrompt) +
    estimateTokens(businessInfo) +
    additionalContexts.reduce((sum, ctx) => sum + estimateTokens(ctx.content || ""), 0) +
    maxTokens + // potential response
    80; // structural tokens and question overhead

  return Math.max(150, contextWindowSize - fixedTokens);
}

/**
 * Genera un resumen compacto del historial con rolling window:
 *
 *  - Las últimas `recentPairsToKeep` interacciones (pregunta + respuesta) se
 *    conservan verbatim, con la respuesta truncada a `maxResponseChars` si es
 *    muy larga, para mantener coherencia conversacional inmediata.
 *  - Las interacciones más viejas se reemplazan por un resumen semántico
 *    (nombres, pedidos, temas consultados) extraído sin modelo.
 *  - El bloque devuelto tiene una estructura estable:
 *
 *      [Resumen de la charla anterior: ...]
 *      [Última interacción 1: ...]
 *      [Última interacción 2: ...]
 *      ...
 *
 *  Esto da al modelo suficiente contexto para responder con coherencia sin
 *  tener que memorizar todo el chat verbatim. El resultado se cachea y se
 *  reusa mientras no llegue un mensaje nuevo (ver `compressChatHistory`).
 *
 * @param {Array}  messages
 * @param {number} maxContextTokens        - Budget total para el bloque.
 * @param {object} [options]
 * @param {number} [options.recentPairsToKeep=3]   - Interacciones verbatim al final.
 * @param {number} [options.maxResponseChars=240]  - Tope por respuesta verbatim.
 * @param {number} [options.maxQuestionChars=120]  - Tope por pregunta verbatim.
 */
export function generateChatSummary(
  messages,
  maxContextTokens = 300,
  {
    recentPairsToKeep = 3,
    maxResponseChars = 240,
    maxQuestionChars = 120,
  } = {}
) {
  if (!messages || messages.length <= 2) return "";

  // Construir pares cliente → bot en orden.
  const pairs = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].author === "Cliente") {
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].author === "Bot" && !messages[j].pending && !messages[j].streaming) {
          pairs.push({ user: messages[i].text, bot: messages[j].text });
          break;
        }
      }
    }
  }
  if (pairs.length === 0) return "";

  // Split: antiguas → resumen, recientes → verbatim.
  const totalPairs = pairs.length;
  const keepFromIndex = Math.max(0, totalPairs - recentPairsToKeep);
  const oldPairs = pairs.slice(0, keepFromIndex);
  const recentPairs = pairs.slice(keepFromIndex);

  // Extraer hechos semánticos solo de las interacciones antiguas.
  const namesSet = new Set();
  const ordersSet = new Set();
  const topicsSet = new Set();
  for (const { user } of oldPairs) {
    for (const fact of extractMessageFacts(user)) {
      if (fact.type === "name") namesSet.add(fact.value);
      else if (fact.type === "order" || fact.type === "item") ordersSet.add(fact.value);
      else if (fact.type === "topic") topicsSet.add(fact.value);
    }
  }

  // También recordar el nombre si apareció en las recientes (no se debe
  // perder un nombre solo porque la última pregunta no lo trae).
  for (const { user } of recentPairs) {
    for (const fact of extractMessageFacts(user)) {
      if (fact.type === "name") namesSet.add(fact.value);
    }
  }

  let names = [...namesSet];
  let orders = [...ordersSet];
  let topics = [...topicsSet];

  // Helper para truncar preservando palabras.
  function truncate(text, max) {
    if (!text) return "";
    if (text.length <= max) return text;
    const slice = text.slice(0, max);
    const cut = slice.lastIndexOf(" ");
    return (cut > max * 0.6 ? slice.slice(0, cut) : slice).trimEnd() + "…";
  }

  // Construir el bloque final respetando el budget. Empezamos con el resumen
  // antiguo (siempre presente si hay pares viejos) y vamos agregando las
  // recientes, truncando si hace falta.
  const parts = [];
  let usedTokens = 0;

  if (oldPairs.length > 0) {
    // Resumen: nombres + pedidos + temas (sin última interacción, ya va aparte).
    const lines = [];
    if (names.length) lines.push(`Nombre del cliente: ${names.join(", ")}`);
    if (orders.length) lines.push(`Pidió: ${orders.join(", ")}`);
    if (topics.length) lines.push(`Consultó sobre: ${topics.join(", ")}`);
    if (lines.length) {
      const head = `Resumen de la charla anterior:\n${lines.map((l) => `- ${l}`).join("\n")}`;
      parts.push(head);
      usedTokens += estimateTokens(head);
    }
  }

  // Pruning del resumen si ya excede el budget (caso extremo: nombres + muchos
  // pedidos + muchos temas con budget chico).
  while (parts.length && usedTokens > maxContextTokens && (topics.length || orders.length)) {
    if (topics.length) topics = topics.slice(0, -1);
    else if (orders.length) orders = orders.slice(0, -1);
    const lines = [];
    if (names.length) lines.push(`Nombre del cliente: ${names.join(", ")}`);
    if (orders.length) lines.push(`Pidió: ${orders.join(", ")}`);
    if (topics.length) lines.push(`Consultó sobre: ${topics.join(", ")}`);
    const head = `Resumen de la charla anterior:\n${lines.map((l) => `- ${l}`).join("\n")}`;
    parts[0] = head;
    usedTokens = estimateTokens(head);
  }

  // Agrego las interacciones recientes verbatim, truncando si hace falta.
  // Recorremos de la MÁS NUEVA a la MÁS VIEJA: si el budget es chico, la
  // última interacción (la más importante para coherencia inmediata) tiene
  // prioridad sobre las más viejas.
  for (let i = recentPairs.length - 1; i >= 0; i--) {
    const { user, bot } = recentPairs[i];
    const truncatedBot = truncate(bot, maxResponseChars);
    const truncatedUser = truncate(user, maxQuestionChars);
    const block = `Última interacción:\n- Cliente: ${truncatedUser}\n  Asistente: ${truncatedBot}`;

    if (usedTokens + estimateTokens(block) > maxContextTokens) {
      // No entra completa: truncamos más agresivo.
      const tight = `Última interacción:\n- Cliente: ${truncate(user, 60)}\n  Asistente: ${truncate(bot, 120)}`;
      if (usedTokens + estimateTokens(tight) <= maxContextTokens) {
        parts.push(tight);
        usedTokens += estimateTokens(tight);
      } else {
        // Último recurso: si quedó al menos 20 tokens libres, metemos
        // lo que entre.
        const available = maxContextTokens - usedTokens;
        if (available > 20) {
          parts.push(truncate(tight, available * 4));
        }
      }
      break;
    }
    parts.push(block);
    usedTokens += estimateTokens(block);
  }

  if (parts.length === 0) return "";
  return parts.join("\n\n");
}

/**
 * Detecta si el contexto actual está overflow: el total de tokens usados
 * (prompt + reservada de respuesta) supera la ventana del modelo. Devuelve
 * además el porcentaje de saturación para mostrar feedback en la UI.
 */
export function estimateContextOverflow(tokenInfo, contextWindowSize) {
  if (!tokenInfo || !contextWindowSize) return { overflow: false, percent: 0, free: contextWindowSize };
  const percent = Math.round((tokenInfo.totalTokens / contextWindowSize) * 100);
  return {
    overflow: percent > 100,
    nearLimit: percent > 80,
    percent,
    free: Math.max(0, contextWindowSize - tokenInfo.totalTokens),
  };
}

/**
 * Resumen forzado del historial usando el modelo. Se usa cuando la
 * compresión sin modelo no alcanza y hay overflow. Produce un párrafo corto
 * (~80-120 tokens) que reemplaza todo el historial.
 *
 * Devuelve el string con el resumen. Si el modelo falla, devuelve el summary
 * ligero como fallback (no rompe el flujo).
 */
export async function summarizeChatWithModel(engine, messages, config = {}) {
  if (!engine || !messages || messages.length === 0) return "";

  // Construir un transcript compacto a partir de los mensajes.
  const transcript = messages
    .filter((m) => m.author && !m.pending && !m.streaming)
    .map((m) => `${m.author === "Cliente" ? "Cliente" : "Asistente"}: ${m.text}`)
    .join("\n")
    .slice(-2400); // tope duro: ~600 tokens

  if (transcript.length < 30) return "";

  const {
    temperature = 0.05,
    topP = 0.85,
    repetitionPenalty = 1.1,
  } = config;

  const systemMsg = [
    "Sos un asistente que resume historiales de chat de un café.",
    "Tu tarea: producir un resumen MUY compacto (máximo 3 frases, ~80 palabras) en español que preserve:",
    "- nombre del cliente si lo dijo,",
    "- qué productos/ítems pidió o consultó,",
    "- temas principales sobre los que preguntó,",
    "- cualquier dato concreto que deba recordarse (reservas, alergias, preferencias).",
    "No incluyas saludos, frases meta ni explicaciones. Solo el resumen.",
  ].join(" ");

  try {
    const response = await engine.chat.completions.create({
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: `Historial a resumir:\n${transcript}\n\nResumen compacto:` },
      ],
      temperature,
      top_p: topP,
      repetition_penalty: repetitionPenalty,
      max_tokens: 128,
    });
    const text = response.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return null; // señal al caller para que use el fallback
    // Forzamos el prefijo estándar para que el modelo downstream lo reconozca.
    return `Resumen de la charla (comprimido): ${text}`;
  } catch {
    return null;
  }
}

/**
 * Build an ordered list of context sections for display in Settings.
 * Returns [{ label, content, tokens }] — one entry per active context block.
 */
export function buildContextPreview({
  systemPrompt = SYSTEM_PROMPT,
  businessInfo = "",
  chatHistory = "",
  additionalContexts = [],
} = {}) {
  const sections = [];

  sections.push({
    label: "System prompt",
    content: systemPrompt || "(vacío)",
    tokens: estimateTokens(systemPrompt),
  });

  if (businessInfo?.trim()) {
    sections.push({
      label: "Información del negocio",
      content: businessInfo.trim(),
      tokens: estimateTokens(businessInfo),
    });
  }

  for (const ctx of additionalContexts || []) {
    if (ctx.content?.trim()) {
      sections.push({
        label: `Contexto: ${ctx.name}`,
        content: ctx.content.trim(),
        tokens: estimateTokens(ctx.content),
      });
    }
  }

  if (chatHistory?.trim()) {
    sections.push({
      label: "Historial resumido",
      content: chatHistory.trim(),
      tokens: estimateTokens(chatHistory),
    });
  }

  return sections;
}

/**
 * Use the loaded model to summarize, order and clean up raw business info text.
 * Returns a processed string (ideally valid JSON).
 */
export async function summarizeBusinessInfo(engine, rawText, config = {}) {
  const {
    temperature = 0.05,
    topP = 0.85,
    repetitionPenalty = 1.1,
  } = config;

  const systemMsg = [
    "Sos un experto en síntesis de información de negocios.",
    "Tu tarea es leer el texto dado y producir un JSON limpio, ordenado y correcto con todos los datos del negocio.",
    "Incluí: nombre, descripción, horarios, sucursales/dirección, teléfono, servicios, formas de pago y cualquier otro dato relevante.",
    "No inventes información. Solo usá lo que está en el texto.",
    "Responde ÚNICAMENTE con el JSON válido, sin texto previo ni posterior, sin comentarios.",
  ].join("\n");

  const userMsg = `Información del negocio:\n${rawText.trim()}\n\nProduce el JSON limpio, ordenado y resumido:`;

  const response = await engine.chat.completions.create({
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg },
    ],
    temperature,
    top_p: topP,
    repetition_penalty: repetitionPenalty,
    max_tokens: 512,
  });

  return response.choices?.[0]?.message?.content?.trim() ?? "";
}