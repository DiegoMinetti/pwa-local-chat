import { describe, expect, it, vi } from "vitest";
import { assessBrowserSupport, getRecommendedSettings } from "./capabilities";

describe("assessBrowserSupport", () => {
  it("rechaza contexto inseguro", async () => {
    const result = await assessBrowserSupport({
      secureContext: false,
      locationRef: { origin: "http://10.0.0.5:3000" },
      navigatorRef: {}
    });

    expect(result.supported).toBe(false);
    expect(result.message).toContain("contexto no seguro");
  });

  it("rechaza navegadores sin WebGPU", async () => {
    const result = await assessBrowserSupport({
      secureContext: true,
      locationRef: { origin: "https://example.com" },
      navigatorRef: {}
    });

    expect(result.supported).toBe(true);
    expect(result.message).toContain("Se usará CPU/WASM");
    expect(result.runtimeSupport).toEqual({ webgpu: false, wasm: true });
  });

  it("activa fallback cuando requestAdapter devuelve null", async () => {
    const result = await assessBrowserSupport({
      secureContext: true,
      locationRef: { origin: "https://example.com" },
      navigatorRef: {
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue(null)
        }
      }
    });

    expect(result.supported).toBe(true);
    expect(result.message).toContain("adaptador GPU");
    expect(result.runtimeSupport).toEqual({ webgpu: false, wasm: true });
  });

  it("acepta cuando WebGPU está disponible", async () => {
    const result = await assessBrowserSupport({
      secureContext: true,
      locationRef: { origin: "https://example.com" },
      navigatorRef: {
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({})
        },
        userAgent: "Mozilla/5.0"
      }
    });

    expect(result.supported).toBe(true);
    expect(result.message).toBe("Entorno WebGPU listo.");
    expect(result.runtimeSupport).toEqual({ webgpu: true, wasm: true });
    expect(result.deviceCapabilities).toBeDefined();
    expect(result.deviceCapabilities.isMobile).toBe(false);
    expect(result.deviceCapabilities.estimatedMemoryGB).toBeGreaterThan(0);
  });
});

describe("getRecommendedSettings", () => {
  it("móvil con WebGPU: modelo 0.5B liviano y ventana 2048", () => {
    const result = getRecommendedSettings({
      runtimeSupport: { webgpu: true, wasm: true },
      deviceCapabilities: { isMobile: true, estimatedMemoryGB: 4 },
    });

    expect(result.modelId).toBe("Qwen2.5-0.5B-Instruct-q4f16_1-MLC");
    expect(result.contextWindowSize).toBe(2048);
    expect(result.fallbackModelIds).toContain("SmolLM2-360M-Instruct-q4f16_1-MLC");
  });

  it("móvil sin WebGPU: ONNX liviano", () => {
    const result = getRecommendedSettings({
      runtimeSupport: { webgpu: false, wasm: true },
      deviceCapabilities: { isMobile: true, estimatedMemoryGB: 2 },
    });

    expect(result.modelId).toBe("onnx-community/Qwen2.5-0.5B-Instruct");
    expect(result.contextWindowSize).toBe(2048);
  });

  it("desktop sin WebGPU: ONNX liviano para CPU", () => {
    const result = getRecommendedSettings({
      runtimeSupport: { webgpu: false, wasm: true },
      deviceCapabilities: { isMobile: false, estimatedMemoryGB: 8 },
    });

    expect(result.modelId).toBe("onnx-community/Qwen2.5-0.5B-Instruct");
  });

  it("desktop con poca memoria: 0.5B en WebGPU", () => {
    const result = getRecommendedSettings({
      runtimeSupport: { webgpu: true, wasm: true },
      deviceCapabilities: { isMobile: false, estimatedMemoryGB: 2 },
    });

    expect(result.modelId).toBe("Qwen2.5-0.5B-Instruct-q4f16_1-MLC");
    expect(result.contextWindowSize).toBe(2048);
  });

  it("desktop con WebGPU y memoria: modelo principal 1.5B", () => {
    const result = getRecommendedSettings({
      runtimeSupport: { webgpu: true, wasm: true },
      deviceCapabilities: { isMobile: false, estimatedMemoryGB: 8 },
    });

    expect(result.modelId).toBe("Qwen2.5-1.5B-Instruct-q4f16_1-MLC");
    expect(result.contextWindowSize).toBe(4096);
  });
});