// Modelo principal por defecto: Qwen2.5 1.5B (~1.0 GB) — buen español y
// descarga mucho menor que Phi-3.5 (2.4 GB), que queda como opción manual.
export const MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

export const DEFAULT_FALLBACK_MODEL_IDS = [
  // WebGPU: opción más liviana si el modelo principal no entra en la GPU.
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
  // CPU/WASM (sin WebGPU): primero el 0.5B (~0.79 GB) por su buen español,
  // y como último recurso el SmolLM2 360M (~0.39 GB), la descarga más liviana.
  "onnx-community/Qwen2.5-0.5B-Instruct",
  "HuggingFaceTB/SmolLM2-360M-Instruct",
];

export const AVAILABLE_MODELS = [
  {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    runtime: "webllm",
    providerModelId: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    label: "Phi-3.5 Mini",
    family: "Phi",
    size: "2.4 GB",
    description: "Mayor precisión general cuando hay buena GPU.",
    requiresWebGPU: true,
    preferredBackend: "webgpu",
    minMemoryGB: { webgpu: 3, wasm: Infinity },
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    runtime: "webllm",
    providerModelId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: "Qwen2.5 1.5B",
    family: "Qwen",
    size: "1.0 GB",
    description: "Muy buen español y arranque más rápido en WebGPU.",
    requiresWebGPU: true,
    preferredBackend: "webgpu",
    minMemoryGB: { webgpu: 2, wasm: Infinity },
  },
  {
    id: "gemma-2-2b-it-q4f16_1-MLC",
    runtime: "webllm",
    providerModelId: "gemma-2-2b-it-q4f16_1-MLC",
    label: "Gemma 2 2B",
    family: "Gemma",
    size: "1.5 GB",
    description: "Eficiente y consistente en equipos con GPU media.",
    requiresWebGPU: true,
    preferredBackend: "webgpu",
    minMemoryGB: { webgpu: 3, wasm: Infinity },
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    runtime: "webllm",
    providerModelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 1B",
    family: "Llama",
    size: "0.9 GB",
    description: "La opción más liviana dentro de WebLLM.",
    requiresWebGPU: true,
    preferredBackend: "webgpu",
    minMemoryGB: { webgpu: 2, wasm: Infinity },
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    runtime: "webllm",
    providerModelId: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 3B",
    family: "Llama",
    size: "2.0 GB",
    description: "Buena calidad, pero exige más memoria GPU.",
    requiresWebGPU: true,
    preferredBackend: "webgpu",
    minMemoryGB: { webgpu: 4, wasm: Infinity },
  },
  {
    id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    runtime: "webllm",
    providerModelId: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    label: "Qwen2.5 0.5B",
    family: "Qwen",
    size: "~0.35 GB",
    description: "Muy liviano y muy rápido en WebGPU, con buen español.",
    requiresWebGPU: true,
    preferredBackend: "webgpu",
    minMemoryGB: { webgpu: 1.5, wasm: Infinity },
  },
  {
    id: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    runtime: "webllm",
    providerModelId: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    label: "SmolLM2 360M",
    family: "SmolLM",
    size: "~0.25 GB",
    description: "El más liviano en WebGPU; ideal para equipos modestos.",
    requiresWebGPU: true,
    preferredBackend: "webgpu",
    minMemoryGB: { webgpu: 1, wasm: Infinity },
  },
  {
    id: "onnx-community/Qwen2.5-1.5B-Instruct",
    runtime: "transformers",
    providerModelId: "onnx-community/Qwen2.5-1.5B-Instruct",
    label: "Qwen2.5 1.5B ONNX",
    family: "Qwen",
    size: "CPU/WASM ~1.79 GB",
    description: "Fallback de mayor calidad cuando WebGPU no está disponible.",
    requiresWebGPU: false,
    preferredBackend: "wasm",
    allowedBackends: ["webgpu", "wasm"],
    dtypeByBackend: { webgpu: "q4", wasm: "q4" },
    minMemoryGB: { webgpu: 3, wasm: 4 },
  },
  {
    id: "onnx-community/Qwen2.5-0.5B-Instruct",
    runtime: "transformers",
    providerModelId: "onnx-community/Qwen2.5-0.5B-Instruct",
    label: "Qwen2.5 0.5B ONNX",
    family: "Qwen",
    size: "CPU/WASM ~0.79 GB",
    description: "Fallback equilibrado para CPU y móviles, buen español.",
    requiresWebGPU: false,
    preferredBackend: "wasm",
    allowedBackends: ["webgpu", "wasm"],
    dtypeByBackend: { webgpu: "q4", wasm: "q4" },
    minMemoryGB: { webgpu: 2, wasm: 2 },
  },
  {
    id: "HuggingFaceTB/SmolLM2-360M-Instruct",
    runtime: "transformers",
    providerModelId: "HuggingFaceTB/SmolLM2-360M-Instruct",
    label: "SmolLM2 360M ONNX",
    family: "SmolLM",
    size: "CPU/WASM ~0.39 GB",
    description: "Descarga más liviana para CPU; español básico pero rápido.",
    requiresWebGPU: false,
    preferredBackend: "wasm",
    allowedBackends: ["webgpu", "wasm"],
    dtypeByBackend: { webgpu: "q4", wasm: "q4" },
    minMemoryGB: { webgpu: 1.5, wasm: 1.5 },
  },
];

export function getModelById(modelId) {
  return AVAILABLE_MODELS.find((model) => model.id === modelId) || null;
}

export function getRuntimeLabel(runtime) {
  if (runtime === "webllm") return "WebGPU";
  if (runtime === "transformers") return "CPU/WASM";
  return runtime;
}

export function normalizeFallbackModelIds(modelId, fallbackModelIds = []) {
  const seen = new Set([modelId]);

  return (Array.isArray(fallbackModelIds) ? fallbackModelIds : [])
    .filter((candidateId) => typeof candidateId === "string" && candidateId.trim())
    .filter((candidateId) => getModelById(candidateId))
    .filter((candidateId) => {
      if (seen.has(candidateId)) return false;
      seen.add(candidateId);
      return true;
    });
}

export function getConfiguredModelIds({ modelId = MODEL_ID, fallbackModelIds = DEFAULT_FALLBACK_MODEL_IDS } = {}) {
  return [modelId, ...normalizeFallbackModelIds(modelId, fallbackModelIds)];
}