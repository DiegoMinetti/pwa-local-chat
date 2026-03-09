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
    message: "Entorno WebGPU listo."
  };
}