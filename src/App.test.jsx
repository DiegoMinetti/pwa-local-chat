import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import App from "./App";

vi.mock("@mlc-ai/web-llm", () => ({}));

vi.mock("./lib/capabilities", () => ({
  assessBrowserSupport: vi.fn(),
  getModelCompatibility: vi.fn(() => ({ compatible: true, reason: "Compatible.", backend: "webgpu" })),
  getRecommendedSettings: vi.fn(() => ({
    modelId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    fallbackModelIds: [],
    contextWindowSize: 4096,
  })),
}));

vi.mock("./lib/chatbot", async () => {
  const actual = await vi.importActual("./lib/chatbot");
  return {
    ...actual,
    createEngine: vi.fn(),
    loadBusinessDocument: vi.fn(),
    streamAssistantReply: vi.fn()
  };
});

import { assessBrowserSupport, getModelCompatibility, getRecommendedSettings } from "./lib/capabilities";
import { createEngine, loadBusinessDocument, streamAssistantReply } from "./lib/chatbot";

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock localStorage to have saved config (not first load)
    const mockConfig = {
      modelId: "Phi-3.5-mini-instruct-q4f16_1-MLC",
      systemPrompt: "You are a helpful assistant.",
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 256,
      repetitionPenalty: 1.0,
      contextWindowSize: 4096,
      businessInfo: ""
    };
    localStorage.setItem('cafe-central-config', JSON.stringify(mockConfig));

    assessBrowserSupport.mockResolvedValue({
      supported: true,
      message: "ok",
      runtimeSupport: { webgpu: true, wasm: true },
      deviceCapabilities: { isMobile: false, estimatedMemoryGB: 8, hasDeviceMemoryAPI: true }
    });
    getModelCompatibility.mockReturnValue({ compatible: true, reason: "Compatible.", backend: "webgpu" });
    loadBusinessDocument.mockResolvedValue("Horario: 8 a 18");
    createEngine.mockResolvedValue({});
    streamAssistantReply.mockImplementation(async (engine, businessInfo, question, onToken) => {
      const reply = "Abrimos a las 8.";
      onToken(reply);
      return reply;
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("muestra el encabezado y arranca el modelo automáticamente", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /asistente de cafe central/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(createEngine).toHaveBeenCalled();
      expect(screen.getAllByText(/ya puedo responder cualquier consulta/i).length).toBeGreaterThan(0);
    });
  });

  it("en la primera visita elige el modelo recomendado para el dispositivo", async () => {
    localStorage.clear();

    render(<App />);

    await waitFor(() => {
      expect(getRecommendedSettings).toHaveBeenCalled();
      expect(createEngine).toHaveBeenCalled();
    });
  });

  it("envía una pregunta y muestra la respuesta del modelo", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText(/ya puedo responder cualquier consulta/i).length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getAllByLabelText(/pregunta del cliente/i).at(-1), {
      target: { value: "Cual es el horario?" }
    });

    fireEvent.click(screen.getAllByRole("button", { name: /enviar/i }).at(-1));

    await waitFor(() => {
      expect(screen.getAllByText(/abrimos a las 8/i).length).toBeGreaterThan(0);
    });
    expect(streamAssistantReply).toHaveBeenCalled();
  });

  it("responde al instante con quickLookup sin usar el modelo", async () => {
    loadBusinessDocument.mockResolvedValue(
      JSON.stringify({
        local: { nombre: "Café Central", telefono: "+54 11 4567 8899" },
        horarios: { regular: { lunes: "08:00 - 20:00" } },
      })
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText(/ya puedo responder cualquier consulta/i).length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getAllByLabelText(/pregunta del cliente/i).at(-1), {
      target: { value: "¿Cuál es el teléfono?" }
    });

    fireEvent.click(screen.getAllByRole("button", { name: /enviar/i }).at(-1));

    await waitFor(() => {
      expect(screen.getAllByText(/\+54 11 4567 8899/).length).toBeGreaterThan(0);
    });
    expect(streamAssistantReply).not.toHaveBeenCalled();
  });

  it("muestra errores de inicialización", async () => {
    assessBrowserSupport.mockResolvedValue({
      supported: false,
      message: "WebGPU no disponible"
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText(/webgpu no disponible/i).length).toBeGreaterThan(0);
    });
  });

  it("si el modelo falla al cargar y se envía una consulta, abre configuración y avisa", { timeout: 15000 }, async () => {
    createEngine.mockRejectedValue(new Error("sin GPU"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText(/error de inicialización/i).length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getAllByLabelText(/pregunta del cliente/i).at(-1), {
      target: { value: "¿Tienen promociones?" },
    });

    fireEvent.click(screen.getAllByRole("button", { name: /enviar/i }).at(-1));

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: /configuración/i }).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/no está disponible en este momento/i).length).toBeGreaterThan(0);
    });
  });

  it("si cierra configuración sin modelo cargado muestra aviso", { timeout: 15000 }, async () => {
    createEngine.mockRejectedValue(new Error("sin GPU"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText(/error de inicialización/i).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole("button", { name: /abrir configuración/i }).at(-1));

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: /configuración/i }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole("button", { name: /cerrar configuración/i }).at(-1));

    await waitFor(() => {
      expect(screen.getAllByText(/no está disponible en este momento/i).length).toBeGreaterThan(0);
    });
  });
});
