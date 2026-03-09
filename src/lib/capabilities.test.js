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

    expect(result.supported).toBe(false);
    expect(result.message).toContain("no expone WebGPU");
  });

  it("rechaza cuando requestAdapter devuelve null", async () => {
    const result = await assessBrowserSupport({
      secureContext: true,
      locationRef: { origin: "https://example.com" },
      navigatorRef: {
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue(null)
        }
      }
    });

    expect(result.supported).toBe(false);
    expect(result.message).toContain("adaptador GPU");
  });

  it("acepta cuando WebGPU está disponible", async () => {
    const result = await assessBrowserSupport({
      secureContext: true,
      locationRef: { origin: "https://example.com" },
      navigatorRef: {
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({})
        }
      }
    });

    expect(result).toEqual({
      supported: true,
      message: "Entorno WebGPU listo."
    });
  });
});