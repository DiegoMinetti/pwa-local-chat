export const MODEL_ID = "Phi-3.5-mini-instruct-q4f16_1-MLC";
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

export const AVAILABLE_MODELS = [
  {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    label: "Phi-3.5 Mini",
    size: "2.4 GB — recomendado, buen balance",
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 1B",
    size: "0.9 GB — más rápido, respuestas simples",
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 3B",
    size: "2.0 GB — mayor calidad",
  },
  {
    id: "gemma-2-2b-it-q4f16_1-MLC",
    label: "Gemma 2 2B",
    size: "1.5 GB — Google, muy eficiente",
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: "Qwen2.5 1.5B",
    size: "1.0 GB — rápido, buen español",
  },
];

export const DEFAULT_CONFIG = {
  modelId: MODEL_ID,
  systemPrompt: SYSTEM_PROMPT,
  temperature: 0.1,
  topP: 0.85,
  maxTokens: 128,
  repetitionPenalty: 1.1,
  contextWindowSize: 4096,
  businessInfo: "",
  additionalContexts: [], // [{ name: string, content: string }, ...]
};

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

export async function createEngine(
  webllmModule,
  onProgress,
  { modelId = MODEL_ID, contextWindowSize = 4096 } = {}
) {
  return webllmModule.CreateMLCEngine(
    modelId,
    { initProgressCallback: onProgress, logLevel: "WARN" },
    { context_window_size: contextWindowSize }
  );
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
 * Generate a condensed summary of the chat history for context.
 */
export function generateChatSummary(messages) {
  if (messages.length <= 2) return ""; // Minimal history
  
  // Get the last few exchanges (user + bot pairs) to avoid token bloat
  const exchanges = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.author === "Bot" && !msg.pending && !msg.streaming) {
      // Found a bot response, get the preceding user message
      for (let j = i - 1; j >= 0; j--) {
        if (messages[j].author === "Cliente") {
          exchanges.unshift(`- Cliente: ${messages[j].text}\n  Bot: ${msg.text}`);
          break;
        }
      }
      if (exchanges.length >= 4) break; // Keep last 4 exchanges (8 messages total)
    }
  }
  
  return exchanges.length > 0 ? exchanges.join("\n") : "";
}