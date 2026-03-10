import {
  AVAILABLE_MODELS,
  DEFAULT_FALLBACK_MODEL_IDS,
  MODEL_ID,
  getModelById,
  getRuntimeLabel,
} from "./modelCatalog";

export { AVAILABLE_MODELS, MODEL_ID };
export const BUSINESS_DOC_PATH = "docs/negocio.txt";
export const FALLBACK_REPLY =
  "Por el momento no tengo esa información, pero con gusto puedo ayudarle con otra consulta sobre Cafe Central.";

export const SUGGESTED_QUESTIONS = [
  "¿Cuál es el horario?",
  "¿Dónde están ubicados?",
  "¿Cuál es el teléfono?",
  "¿Cómo se puede pagar?",
  "¿Qué promociones tienen?",
];
export const SYSTEM_PROMPT = [
  "Sos el asistente virtual de Cafe Central.",
  "Respondé SOLO usando la información del contexto provisto. No inventes datos.",
  'Si la información no está disponible, respondé exactamente: "No tengo esa información."',
  "Respondé siempre en español, en máximo dos frases cortas, con tono amable, formal y respetuoso.",
  "No incluyas etiquetas, prefijos ni explicaciones meta.",
].join("\n");

export const DEFAULT_CONFIG = {
  modelId: MODEL_ID,
  fallbackModelIds: DEFAULT_FALLBACK_MODEL_IDS,
  systemPrompt: SYSTEM_PROMPT,
  temperature: 0.1,
  topP: 0.85,
  maxTokens: 128,
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

export function buildMessages({ businessInfo, question, systemPrompt = SYSTEM_PROMPT, chatHistory = "", additionalContexts = [] }) {
  // Minify JSON to reduce token count; fall back to original if not valid JSON.
  let compactInfo = businessInfo.trim();
  try {
    compactInfo = JSON.stringify(JSON.parse(businessInfo));
  } catch {
    // plain-text format — use as-is
  }
  
  let userContent = `Contexto del negocio:\n${compactInfo}`;
  
  // Include additional contexts
  for (const ctx of additionalContexts) {
    if (ctx.content?.trim()) {
      let compactCtx = ctx.content.trim();
      try {
        compactCtx = JSON.stringify(JSON.parse(compactCtx));
      } catch {
        // plain-text — use as-is
      }
      userContent += `\n\nContexto: ${ctx.name}\n${compactCtx}`;
    }
  }
  
  // Include chat history if available
  if (chatHistory.trim()) {
    userContent += `\n\nHistorial de conversación:\n${chatHistory}`;
  }
  
  userContent += `\n\nPregunta: ${question.trim()}`;
  
  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: userContent,
    },
  ];
}

export function sanitizeAssistantReply(rawReply) {
  const fallback = FALLBACK_REPLY;

  if (!rawReply || typeof rawReply !== "string") {
    return fallback;
  }

  let sanitized = rawReply.trim();

  sanitized = sanitized.replace(/<\|[^>]+\|>/g, " ").trim();

  const stopMarkers = [
    /\nContexto del negocio\s*:/i,
    /\nPregunta\s*:/i,
    /\nCliente\s*:/i,
    /\nInformaci[oó]n del negocio\s*:/i,
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
    /^no tengo esa información\.?$/i.test(sanitized)
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
 */
export function quickLookup(businessInfo, question) {
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

  if (/horario|abre|cierra|cuando|lunes|viernes|sabado|domingo|manana|tarde/.test(q)) {
    const regular = data.horarios?.regular;
    if (!regular) return null;
    const lines = Object.entries(regular).map(([day, hours]) => `${day}: ${hours}`);
    if (data.horarios.cocina_cierra) lines.push(`Cocina: ${data.horarios.cocina_cierra}`);
    return lines.join("\n");
  }
  if (/direcci|donde|ubicaci|calle|domicilio|llegar/.test(q)) {
    const suc = data.sucursales;
    if (!suc?.length) return null;
    return suc.map((s) => `${s.nombre}: ${s.direccion}`).join("\n");
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
    return null; // let the model answer
  }
  if (/reserva/.test(q)) {
    if (!data.servicios?.reservas) return null;
    const faq = data.faq?.find((f) => /reserva/i.test(f.pregunta));
    return faq?.respuesta ?? "Sí, aceptamos reservas desde el sitio web o por teléfono.";
  }
  if (/mascota|perro|gato|pet/.test(q)) {
    const hasPet = data.sucursales?.some((s) => s.pet_friendly);
    return hasPet ? "Sí, somos pet friendly en las mesas del exterior." : null;
  }
  if (/wifi|internet/.test(q)) {
    return data.servicios?.wifi ? "Sí, contamos con WiFi disponible en todas las sucursales." : null;
  }
  if (/delivery|domicilio|envio/.test(q)) {
    return data.servicios?.delivery ? "Sí, realizamos delivery." : null;
  }
  if (/takeaway|para llevar|llevar/.test(q)) {
    return data.servicios?.takeaway ? "Sí, tenemos servicio de takeaway (para llevar)." : null;
  }
  if (/vegetarian|vegano|sin gluten|celiac|leche vegetal/.test(q)) {
    const d = data.dietas_y_opciones;
    if (!d) return null;
    const opts = [];
    if (d.vegetariano) opts.push("opciones vegetarianas");
    if (d.vegano) opts.push("opciones veganas");
    if (d.sin_gluten) opts.push("sin gluten");
    if (d.leche_vegetal_disponible?.length)
      opts.push(`leche vegetal (${d.leche_vegetal_disponible.join(", ")})`);
    return opts.length ? `Sí, contamos con: ${opts.join(", ")}.` : null;
  }
  if (/nombre|que es|que hacen|dedica|descripci|cafeteria/.test(q)) {
    return data.local?.descripcion ?? null;
  }
  if (/hola|buenas|buen[oa]s|salud/.test(q)) {
    return `¡Hola! Soy el asistente de ${data.local?.nombre ?? "Cafe Central"}. ¿En qué puedo ayudarle?`;
  }
  return null;
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
  } = config;

  const stream = await engine.chat.completions.create({
    messages: buildMessages({ businessInfo, question, systemPrompt, chatHistory, additionalContexts }),
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
  return sanitizeAssistantReply(accumulated);
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
  } = config;

  const response = await engine.chat.completions.create({
    messages: buildMessages({ businessInfo, question, systemPrompt, chatHistory, additionalContexts }),
    temperature,
    top_p: topP,
    repetition_penalty: repetitionPenalty,
    max_tokens: maxTokens,
    stop: ["\nContexto del negocio:", "\nPregunta:", "\nCliente:"],
  });
  return sanitizeAssistantReply(response.choices?.[0]?.message?.content);
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
}) {
  const messages = buildMessages({
    businessInfo,
    question,
    systemPrompt,
    chatHistory,
    additionalContexts,
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
 * Generate a compact semantic summary of the conversation history.
 *
 * Instead of accumulating full transcripts, this function extracts key facts
 * (client name, orders, topics consulted) from every exchange and keeps only
 * the last interaction verbatim for coherence. When the result exceeds the
 * token budget it silently prunes the least relevant facts (topics first, then
 * order details) so the context stays within the model's window — completely
 * transparent to the user.
 *
 * @param {Array}  messages          - Full chat message array.
 * @param {number} maxContextTokens  - Token budget for history (default 300).
 */
export function generateChatSummary(messages, maxContextTokens = 300) {
  if (!messages || messages.length <= 2) return "";

  // Build ordered user → bot pairs from the message list.
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

  const lastExchange = pairs[pairs.length - 1];

  // Extract and deduplicate semantic facts from ALL user messages.
  const namesSet = new Set();
  const ordersSet = new Set();
  const topicsSet = new Set();
  for (const { user } of pairs) {
    for (const fact of extractMessageFacts(user)) {
      if (fact.type === "name") namesSet.add(fact.value);
      else if (fact.type === "order" || fact.type === "item") ordersSet.add(fact.value);
      else if (fact.type === "topic") topicsSet.add(fact.value);
    }
  }

  let names = [...namesSet];
  let orders = [...ordersSet];
  let topics = [...topicsSet];

  let summary = buildSummaryText({ names, orders, topics, lastExchange });

  // Prune to fit the token budget: remove topics first, then orders. Names and
  // the last exchange are always preserved to maintain conversation coherence.
  if (estimateTokens(summary) > maxContextTokens) {
    while (
      topics.length > 0 &&
      estimateTokens(buildSummaryText({ names, orders, topics, lastExchange })) > maxContextTokens
    ) {
      topics = topics.slice(0, -1);
    }
    while (
      orders.length > 0 &&
      estimateTokens(buildSummaryText({ names, orders, topics, lastExchange })) > maxContextTokens
    ) {
      orders = orders.slice(0, -1);
    }
    summary = buildSummaryText({ names, orders, topics, lastExchange });
  }

  return summary;
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
    temperature = 0.1,
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