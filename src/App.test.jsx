import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import App from "./App";

vi.mock("@mlc-ai/web-llm", () => ({}));

vi.mock("./lib/capabilities", () => ({
  assessBrowserSupport: vi.fn()
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

import { assessBrowserSupport } from "./lib/capabilities";
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
    
    assessBrowserSupport.mockResolvedValue({ supported: true, message: "ok" });
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

  it("muestra el encabezado principal", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /asistente de cafe central/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/soy el asistente de cafe central/i)).toBeInTheDocument();
    });
  });

  it("envía una pregunta y muestra la respuesta", async () => {
    render(<App />);

    // Wait for engine to be ready (model loads immediately in test)
    await waitFor(() => {
      expect(screen.getByText(/soy el asistente de cafe central/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getAllByLabelText(/pregunta del cliente/i).at(-1), {
      target: { value: "Cual es el horario?" }
    });

    await waitFor(() => {
      const buttons = screen.getAllByRole("button", { name: /enviar/i });
      expect(buttons.at(-1)).toBeEnabled();
    });

    fireEvent.click(screen.getAllByRole("button", { name: /enviar/i }).at(-1));

    await waitFor(() => {
      expect(screen.getByText("Cual es el horario?")).toBeInTheDocument();
      expect(screen.getByText(/abrimos a las 8/i)).toBeInTheDocument();
    });

    expect(streamAssistantReply).toHaveBeenCalledWith(
      {},
      "Horario: 8 a 18",
      "Cual es el horario?",
      expect.any(Function),
      expect.objectContaining({ temperature: expect.any(Number) })
    );
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
});