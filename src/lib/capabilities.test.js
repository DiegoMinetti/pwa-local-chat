import { describe, expect, it, vi } from "vitest";
import { assessBrowserSupport } from "./capabilities";

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