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
export function isModelCompatible(modelId, deviceCapabilities) {
  const { estimatedMemoryGB, isMobile } = deviceCapabilities;
  
  // Model size requirements (approximate GPU memory needed)
  const modelRequirements = {
    "Phi-3.5-mini-instruct-q4f16_1-MLC": { minMemoryGB: 3, minTotalGB: 4 },
    "Llama-3.2-1B-Instruct-q4f16_1-MLC": { minMemoryGB: 1.5, minTotalGB: 2 },
    "Llama-3.2-3B-Instruct-q4f16_1-MLC": { minMemoryGB: 2.5, minTotalGB: 4 },
    "gemma-2-2b-it-q4f16_1-MLC": { minMemoryGB: 2, minTotalGB: 3 },
    "Qwen2.5-1.5B-Instruct-q4f16_1-MLC": { minMemoryGB: 1.5, minTotalGB: 2 },
  };
  
  const requirements = modelRequirements[modelId];
  if (!requirements) return true; // unknown model, allow it
  
  // On mobile, be more conservative
  const memoryThreshold = isMobile ? requirements.minTotalGB : requirements.minMemoryGB;
  
  return estimatedMemoryGB >= memoryThreshold;
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
      message: `La app se abrió en un contexto no seguro (${origin}). WebGPU y la PWA requieren HTTPS o http://localhost.`
    };
  }

  if (!navigatorRef?.gpu) {
    return {
      supported: false,
      message: "El navegador no expone WebGPU. Usá una versión reciente de Chrome, Edge o Safari con aceleración por hardware activa."
    };
  }

  try {
    const adapter = await navigatorRef.gpu.requestAdapter();

    if (!adapter) {
      return {
        supported: false,
        message: "El navegador reconoce WebGPU, pero no pudo obtener un adaptador GPU utilizable."
      };
    }
  } catch (error) {
    return {
      supported: false,
      message: `Falló la inicialización del adaptador WebGPU: ${error.message}`
    };
  }

  return {
    supported: true,
    message: "Entorno WebGPU listo.",
    deviceCapabilities: getDeviceCapabilities(),
  };
}