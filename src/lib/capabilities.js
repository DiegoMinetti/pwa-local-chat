import { DEFAULT_FALLBACK_MODEL_IDS, MODEL_ID, getModelById, getRuntimeLabel } from "./modelCatalog";

/**
 * Estimate device memory and compute capability.
 */
export function getDeviceCapabilities() {
  const nav = navigator;
  
  // Try to get device memory (Chrome/Edge only)
  const deviceMemory = nav.deviceMemory || null;
  
  // Detect mobile devices
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(nav.userAgent);
  
  // Estimate available memory
  let estimatedMemoryGB = 4; // default assumption
  if (deviceMemory) {
    estimatedMemoryGB = deviceMemory;
  } else if (isMobile) {
    estimatedMemoryGB = 2; // conservative estimate for mobile
  }
  
  return {
    isMobile,
    estimatedMemoryGB,
    hasDeviceMemoryAPI: !!deviceMemory,
  };
}

/**
 * Check if a model is compatible with device capabilities.
 */
export function getModelCompatibility(modelId, browserSupportOrCapabilities) {
  const model = getModelById(modelId);
  if (!model) {
    return {
      compatible: false,
      reason: "Modelo no registrado.",
      backend: null,
    };
  }

  const deviceCapabilities = browserSupportOrCapabilities?.deviceCapabilities
    ? browserSupportOrCapabilities.deviceCapabilities
    : browserSupportOrCapabilities;
  const runtimeSupport = browserSupportOrCapabilities?.runtimeSupport || {
    webgpu: true,
    wasm: true,
  };
  const estimatedMemoryGB = deviceCapabilities?.estimatedMemoryGB || 4;
  const isMobile = Boolean(deviceCapabilities?.isMobile);

  const allowedBackends = model.allowedBackends || [model.preferredBackend || "webgpu"];
  const compatibleBackends = allowedBackends.filter((backend) => runtimeSupport[backend]);

  if (model.requiresWebGPU && !runtimeSupport.webgpu) {
    return {
      compatible: false,
      reason: "Requiere WebGPU.",
      backend: null,
    };
  }

  if (!compatibleBackends.length) {
    return {
      compatible: false,
      reason: `El runtime ${getRuntimeLabel(model.runtime)} no está disponible en este navegador.`,
      backend: null,
    };
  }

  const preferredOrder = model.preferredBackend
    ? [model.preferredBackend, ...compatibleBackends.filter((backend) => backend !== model.preferredBackend)]
    : compatibleBackends;

  for (const backend of preferredOrder) {
    if (!compatibleBackends.includes(backend)) continue;

    const minMemoryGB = model.minMemoryGB?.[backend] ?? 0;
    const mobilePenalty = isMobile && backend === "wasm" ? 1 : 0;
    if (estimatedMemoryGB >= minMemoryGB + mobilePenalty) {
      return {
        compatible: true,
        reason: "Compatible.",
        backend,
      };
    }
  }

  const minRequired = preferredOrder
    .map((backend) => model.minMemoryGB?.[backend])
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)[0];

  return {
    compatible: false,
    reason: minRequired
      ? `Requiere al menos ~${minRequired} GB disponibles para ${getRuntimeLabel(model.runtime)}.`
      : "No hay backend compatible para este dispositivo.",
    backend: null,
  };
}

export function isModelCompatible(modelId, browserSupportOrCapabilities) {
  return getModelCompatibility(modelId, browserSupportOrCapabilities).compatible;
}

/**
 * Recommended model + window settings for the current device.
 *
 * Mobile (iPhone/Android) gets the lightest viable defaults: Safari iOS kills
 * the tab near ~1.5-2 GB of memory, so the 1.5B model (1 GB of weights plus
 * KV cache and runtime) is too risky there. A 2048-token window also halves
 * the KV cache and speeds up engine startup.
 */
export function getRecommendedSettings(browserSupport) {
  const capabilities = browserSupport?.deviceCapabilities || getDeviceCapabilities();
  const hasWebGPU = Boolean(browserSupport?.runtimeSupport?.webgpu);

  if (capabilities.isMobile) {
    return hasWebGPU
      ? {
          modelId: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
          fallbackModelIds: [
            "SmolLM2-360M-Instruct-q4f16_1-MLC",
            "onnx-community/Qwen2.5-0.5B-Instruct",
            "HuggingFaceTB/SmolLM2-360M-Instruct",
          ],
          contextWindowSize: 2048,
        }
      : {
          modelId: "onnx-community/Qwen2.5-0.5B-Instruct",
          fallbackModelIds: ["HuggingFaceTB/SmolLM2-360M-Instruct"],
          contextWindowSize: 2048,
        };
  }

  if (!hasWebGPU) {
    return {
      modelId: "onnx-community/Qwen2.5-0.5B-Instruct",
      fallbackModelIds: ["HuggingFaceTB/SmolLM2-360M-Instruct"],
      contextWindowSize: 2048,
    };
  }

  if (capabilities.estimatedMemoryGB < 4) {
    return {
      modelId: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
      fallbackModelIds: [
        "SmolLM2-360M-Instruct-q4f16_1-MLC",
        "onnx-community/Qwen2.5-0.5B-Instruct",
        "HuggingFaceTB/SmolLM2-360M-Instruct",
      ],
      contextWindowSize: 2048,
    };
  }

  return {
    modelId: MODEL_ID,
    fallbackModelIds: [...DEFAULT_FALLBACK_MODEL_IDS],
    contextWindowSize: 4096,
  };
}

export async function assessBrowserSupport({
  navigatorRef = globalThis.navigator,
  locationRef = globalThis.location,
  secureContext = globalThis.isSecureContext
} = {}) {
  const origin = locationRef?.origin || "origen desconocido";

  if (!secureContext) {
    return {
      supported: false,
      message: `La app se abrió en un contexto no seguro (${origin}). La PWA requiere HTTPS o http://localhost.`
    };
  }

  const runtimeSupport = {
    webgpu: false,
    wasm: typeof WebAssembly === "object",
  };

  let webgpuMessage = "WebGPU no disponible.";

  if (navigatorRef?.gpu) {
    try {
      const adapter = await navigatorRef.gpu.requestAdapter();

      if (adapter) {
        runtimeSupport.webgpu = true;
        webgpuMessage = "Entorno WebGPU listo.";
      } else {
        webgpuMessage = "El navegador reconoce WebGPU, pero no pudo obtener un adaptador GPU utilizable.";
      }
    } catch (error) {
      webgpuMessage = `Falló la inicialización del adaptador WebGPU: ${error.message}`;
    }
  } else {
    webgpuMessage = "El navegador no expone WebGPU. Se usará CPU/WASM cuando haya un modelo compatible.";
  }

  if (!runtimeSupport.webgpu && !runtimeSupport.wasm) {
    return {
      supported: false,
      message: "Este navegador no ofrece ni WebGPU ni WebAssembly utilizable para cargar modelos locales."
    };
  }

  return {
    supported: true,
    message: webgpuMessage,
    runtimeSupport,
    deviceCapabilities: getDeviceCapabilities(),
  };
}