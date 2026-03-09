import { describe, expect, it, vi } from "vitest";
import {
  BUSINESS_DOC_PATH,
  FALLBACK_REPLY,
  MODEL_ID,
  SUGGESTED_QUESTIONS,
  SYSTEM_PROMPT,
  buildMessages,
  createEngine,
  getAssistantReply,
  loadBusinessDocument,
  quickLookup,
  sanitizeAssistantReply
} from "./chatbot";

describe("chatbot helpers", () => {
  it("buildMessages arma el prompt con sistema, negocio y pregunta", () => {
    const messages = buildMessages({
      businessInfo: "Horario: 8 a 18",
      question: "Cual es el horario?"
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain(SYSTEM_PROMPT);
    expect(messages[0].content).toContain("Respondé siempre en español");
    expect(messages[0].content).toContain("tono amable, formal y respetuoso");
    expect(messages[1].content).toContain("Horario: 8 a 18");
    expect(messages[1].content).toContain("Pregunta: Cual es el horario?");
  });

  it("loadBusinessDocument descarga el archivo local", async () => {
    const text = await loadBusinessDocument(
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("Cafe Aurora")
      }),
      "/base/"
    );

    expect(text).toBe("Cafe Aurora");
  });

  it("loadBusinessDocument falla si el archivo no responde", async () => {
    await expect(
      loadBusinessDocument(vi.fn().mockResolvedValue({ ok: false }), "/base/")
    ).rejects.toThrow("No se pudo cargar la información del negocio.");
  });

  it("createEngine usa el modelo configurado", async () => {
    const CreateMLCEngine = vi.fn().mockResolvedValue({ ok: true });

    await createEngine({ CreateMLCEngine }, vi.fn());

    expect(CreateMLCEngine).toHaveBeenCalledWith(
      MODEL_ID,
      expect.objectContaining({ logLevel: "WARN" }),
      expect.objectContaining({ context_window_size: 4096 })
    );
  });

  it("getAssistantReply devuelve la respuesta del modelo", async () => {
    const engine = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "Abre de lunes a viernes." } }]
          })
        }
      }
    };

    const reply = await getAssistantReply(engine, "Horario: lun-vie", "Cuando abre?");

    expect(reply).toBe("Abre de lunes a viernes.");
    expect(engine.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.any(Array),
        temperature: 0.1,
        max_tokens: 128,
        repetition_penalty: 1.1,
        top_p: 0.85,
        stop: expect.any(Array)
      })
    );
  });

  it("sanitizeAssistantReply elimina etiquetas y contexto repetido", () => {
    const rawReply = [
      "Respuesta: Soy el asistente virtual de Cafe Aurora.",
      "",
      "Información del negocio:",
      "Nombre del negocio: Cafe Aurora"
    ].join("\n");

    expect(sanitizeAssistantReply(rawReply)).toBe("Soy el asistente virtual de Cafe Aurora.");
  });

  it("sanitizeAssistantReply usa fallback si el modelo devuelve la instrucción", () => {
    const rawReply = "Sí, si la respuesta no está en la información disponible, decir que no se dispone de esa información.";

    expect(sanitizeAssistantReply(rawReply)).toBe(FALLBACK_REPLY);
  });

  it("sanitizeAssistantReply reemplaza el fallback seco por el amable", () => {
    expect(sanitizeAssistantReply("No se dispone de esa información.")).toBe(FALLBACK_REPLY);
  });

  it("sanitizeAssistantReply reemplaza 'No tengo esa información' por el fallback amable", () => {
    expect(sanitizeAssistantReply("No tengo esa información.")).toBe(FALLBACK_REPLY);
  });

  it("expone la ruta esperada del archivo de negocio", () => {
    expect(BUSINESS_DOC_PATH).toBe("docs/negocio.txt");
  });

  describe("SUGGESTED_QUESTIONS", () => {
    it("expone un array de 5 preguntas sugeridas", () => {
      expect(Array.isArray(SUGGESTED_QUESTIONS)).toBe(true);
      expect(SUGGESTED_QUESTIONS).toHaveLength(5);
    });

    it("incluye preguntas sobre horario, ubicación, teléfono, pagos y promociones", () => {
      const joined = SUGGESTED_QUESTIONS.join(" ").toLowerCase();
      expect(joined).toMatch(/horario/);
      expect(joined).toMatch(/ubicad|donde/);
      expect(joined).toMatch(/tel[eé]fono/);
      expect(joined).toMatch(/pag/);
      expect(joined).toMatch(/promoci/);
    });
  });

  describe("quickLookup", () => {
    // Matches the new JSON structure of negocio.txt
    const doc = JSON.stringify({
      local: {
        nombre: "Cafe Central",
        descripcion: "Cafetería de especialidad, brunch y pastelería artesanal.",
        telefono: "+54 11 4567 8899",
      },
      horarios: {
        regular: {
          lunes: "08:00 - 20:00",
          sabado: "09:00 - 23:00",
          domingo: "09:00 - 20:00",
        },
        cocina_cierra: "30 minutos antes del cierre",
      },
      sucursales: [
        { nombre: "Cafe Central - Centro", direccion: "Av. Corrientes 1234, Buenos Aires", pet_friendly: true },
      ],
      servicios: {
        wifi: true,
        takeaway: true,
        delivery: true,
        reservas: true,
        medios_de_pago: ["Efectivo", "Tarjeta de débito", "MercadoPago"],
      },
      dietas_y_opciones: {
        vegetariano: true,
        vegano: true,
        sin_gluten: true,
        leche_vegetal_disponible: ["almendra", "avena"],
      },
      faq: [
        { pregunta: "¿Aceptan reservas?", respuesta: "Sí, desde el sitio web o por teléfono." },
      ],
    });

    it("devuelve el horario cuando se pregunta por horario", () => {
      expect(quickLookup(doc, "¿Cuál es el horario?")).toMatch(/lunes|sabado/i);
    });

    it("devuelve la dirección cuando se pregunta dónde están", () => {
      expect(quickLookup(doc, "¿Dónde están ubicados?")).toMatch(/corrientes/i);
    });

    it("devuelve el teléfono cuando se pregunta por teléfono", () => {
      expect(quickLookup(doc, "¿Cuál es el teléfono?")).toMatch(/4567/);
    });

    it("devuelve los métodos de pago cuando se pregunta cómo pagar", () => {
      expect(quickLookup(doc, "¿Cómo se puede pagar?")).toMatch(/efectivo/i);
    });

    it("devuelve info de reservas cuando se pregunta por reservas", () => {
      expect(quickLookup(doc, "¿Aceptan reservas?")).toMatch(/sí/i);
    });

    it("devuelve opciones dietéticas cuando se pregunta por opciones vegetarianas", () => {
      expect(quickLookup(doc, "¿Tienen opciones vegetarianas?")).toMatch(/vegetarian/i);
    });

    it("devuelve null para promociones — responde el modelo", () => {
      expect(quickLookup(doc, "¿Qué promociones tienen?")).toBeNull();
    });

    it("devuelve null para preguntas que el modelo debe responder", () => {
      expect(quickLookup(doc, "¿Tienen café de Etiopía?")).toBeNull();
    });

    it("devuelve null si businessInfo está vacío o no es JSON", () => {
      expect(quickLookup("", "¿Cuál es el horario?")).toBeNull();
      expect(quickLookup(null, "¿Cuál es el horario?")).toBeNull();
      expect(quickLookup("texto plano sin JSON", "¿Cuál es el horario?")).toBeNull();
    });
  });
});