import { pipeline, env } from "@huggingface/transformers";
import { getModelById } from "./modelCatalog";

const DEFAULT_GENERATION_CONFIG = {
  temperature: 0.1,
  topP: 0.85,
  maxTokens: 128,
  repetitionPenalty: 1.1,
};

let currentGenerator = null;
let currentModel = null;
let currentBackend = null;

function buildPrompt(messages) {
  if (currentGenerator?.tokenizer?.apply_chat_template) {
    return currentGenerator.tokenizer.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
    });
  }

  return messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
}

function extractGeneratedText(result) {
  if (typeof result === "string") return result;
  if (Array.isArray(result) && result[0]?.generated_text) return result[0].generated_text;
  if (result?.generated_text) return result.generated_text;
  return "";
}

async function disposeCurrentGenerator() {
  await currentGenerator?.dispose?.();
  await currentGenerator?.model?.dispose?.();
  await currentGenerator?.tokenizer?.dispose?.();
  currentGenerator = null;
  currentModel = null;
  currentBackend = null;
}

async function loadModel({ modelId, preferredBackend }) {
  const model = getModelById(modelId);
  if (!model) {
    throw new Error(`Modelo no soportado: ${modelId}`);
  }

  env.allowLocalModels = false;
  env.useBrowserCache = true;

  const backend = model.allowedBackends?.includes(preferredBackend)
    ? preferredBackend
    : model.preferredBackend || "wasm";
  const dtype = model.dtypeByBackend?.[backend] || "q4";

  if (currentGenerator && currentModel === modelId && currentBackend === backend) {
    return { modelId, backend };
  }

  await disposeCurrentGenerator();
  currentGenerator = await pipeline("text-generation", model.providerModelId, {
    device: backend,
    dtype,
  });
  currentModel = modelId;
  currentBackend = backend;

  return { modelId, backend };
}

async function generateCompletion({
  messages,
  temperature = DEFAULT_GENERATION_CONFIG.temperature,
  top_p,
  topP,
  repetition_penalty,
  repetitionPenalty,
  max_tokens,
  maxTokens,
}) {
  if (!currentGenerator) {
    throw new Error("No hay un modelo CPU cargado en el worker.");
  }

  const prompt = buildPrompt(messages);
  const result = await currentGenerator(prompt, {
    max_new_tokens: max_tokens ?? maxTokens ?? DEFAULT_GENERATION_CONFIG.maxTokens,
    temperature,
    top_p: top_p ?? topP ?? DEFAULT_GENERATION_CONFIG.topP,
    repetition_penalty:
      repetition_penalty ?? repetitionPenalty ?? DEFAULT_GENERATION_CONFIG.repetitionPenalty,
    do_sample: temperature > 0,
    return_full_text: false,
  });

  return {
    text: extractGeneratedText(result),
  };
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};

  try {
    if (type === "load") {
      self.postMessage({ type: "progress", id, payload: { progress: 0 } });
      const result = await loadModel(payload);
      self.postMessage({ type: "progress", id, payload: { progress: 1 } });
      self.postMessage({ type: "result", id, payload: result });
      return;
    }

    if (type === "generate") {
      const result = await generateCompletion(payload);
      self.postMessage({ type: "result", id, payload: result });
      return;
    }

    if (type === "unload") {
      await disposeCurrentGenerator();
      self.postMessage({ type: "result", id, payload: { ok: true } });
      return;
    }

    if (type === "interrupt") {
      self.postMessage({ type: "result", id, payload: { ok: true } });
      return;
    }

    throw new Error(`Operación no soportada: ${type}`);
  } catch (error) {
    self.postMessage({
      type: "error",
      id,
      payload: { message: error instanceof Error ? error.message : String(error) },
    });
  }
};