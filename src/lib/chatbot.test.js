import { describe, expect, it, vi } from "vitest";
import {
  BUSINESS_DOC_PATH,
  FALLBACK_REPLY,
  fetchDynamicContexts,
  estimateContextOverflow,
  generateChatSummary,
  getCurrentContextInfo,
  MODEL_ID,
  normalizeDynamicSources,
  SUGGESTED_QUESTIONS,
  SYSTEM_PROMPT,
  buildMessages,
  buildSystemPrompt,
  DEFAULT_ASSISTANT_NAME,
  computeHistoryBudget,
  createEngine,
  getAssistantReply,
  loadBusinessDocument,
  quickLookup,
  sanitizeAssistantReply,
  sanitizeStreamingText,
  summarizeChatWithModel,
  toDynamicContext
} from "./chatbot";

describe("chatbot helpers", () => {
  it("buildMessages arma el prompt con sistema, negocio, info_actual y pregunta", () => {
    const messages = buildMessages({
      businessInfo: "Horario: 8 a 18",
      question: "Cual es el horario?",
      now: new Date("2026-06-11T14:30:00Z"),
      clientTimeZone: "UTC",
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain(SYSTEM_PROMPT);
    expect(messages[0].content).toContain("cálido, amable y proactivo");
    // El bloque «Información actual» se inyecta en el user message.
    expect(messages[1].content).toContain("Información del negocio");
    expect(messages[1].content).toContain("Información actual");
    expect(messages[1].content).toMatch(/hoy es \w+/);
    expect(messages[1].content).toMatch(/hora \d{2}:\d{2}/);
    expect(messages[1].content).toContain("Horario: 8 a 18");
    expect(messages[1].content).toContain("Pregunta: Cual es el horario?");
  });

  it("buildSystemPrompt incluye el nombre del asistente y las reglas cálidas/proactivas", () => {
    const prompt = buildSystemPrompt("Martina");
    expect(prompt).toContain("Martina");
    expect(prompt).toContain("cálido, amable y proactivo");
    expect(prompt).toContain("ya te averiguo");
    expect(prompt).toMatch(/voseo|vos/i);
  });

  it("buildSystemPrompt cae al default si el nombre es vacío", () => {
    const prompt = buildSystemPrompt("   ");
    expect(prompt).toContain(DEFAULT_ASSISTANT_NAME);
  });

  it("quickLookup usa el assistantName configurable en el saludo", () => {
    const info = JSON.stringify({ local: { nombre: "Cafe X" } });
    const reply = quickLookup(info, "hola", { assistantName: "Lucía" });
    expect(reply).toContain("Lucía");
    expect(reply).toContain("Cafe X");
  });

  it("buildMessages sin businessInfo no rompe y marca el bloque como vacío", () => {
    const messages = buildMessages({
      businessInfo: "",
      question: "Hola?",
    });

    expect(messages[1].content).toContain("(sin datos del negocio cargados)");
    expect(messages[1].content).toContain("Información actual");
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

  describe("sanitizeStreamingText", () => {
    it("devuelve '' para entradas vacías o no string", () => {
      expect(sanitizeStreamingText("")).toBe("");
      expect(sanitizeStreamingText(null)).toBe("");
      expect(sanitizeStreamingText(undefined)).toBe("");
      expect(sanitizeStreamingText(42)).toBe("");
    });

    it("elimina tokens especiales del estilo <|im_end|>", () => {
      expect(sanitizeStreamingText("Hola <|im_end|> mundo")).toBe("Hola  mundo");
    });

    it("corta al encontrar el marcador de contexto del negocio", () => {
      const stream = "Respuesta: 8 a 20.\nContexto del negocio: ...";
      expect(sanitizeStreamingText(stream)).toBe("Respuesta: 8 a 20.");
    });

    it("corta al encontrar el marcador de pregunta del cliente", () => {
      const stream = "Te esperamos pronto.\nPregunta: Hola";
      expect(sanitizeStreamingText(stream)).toBe("Te esperamos pronto.");
    });

    it("corta al encontrar el marcador de cliente o respuesta breve", () => {
      expect(sanitizeStreamingText("Hola\nCliente: chau")).toBe("Hola");
      expect(sanitizeStreamingText("Hola\nRespuesta breve: otra cosa")).toBe("Hola");
      expect(sanitizeStreamingText("Hola\nInformación del negocio: foo")).toBe("Hola");
    });

    it("no sustituye por fallback: si el texto queda vacío, devuelve ''", () => {
      // Diferencia clave con sanitizeAssistantReply: el streaming nunca debe
      // mostrar el fallback durante el reveal, solo cuando termina.
      expect(sanitizeStreamingText("<|im_start|>")).toBe("");
    });
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

    it("responde promociones de forma determinística — nunca llega al modelo", () => {
      const reply = quickLookup(doc, "¿Qué promociones tienen?");
      expect(reply).toMatch(/no tengo promociones cargadas/i);
    });

    it("lista promociones cuando el documento las tiene", () => {
      const withPromos = JSON.stringify({
        ...JSON.parse(doc),
        promociones: [{ nombre: "2x1 en café", descripcion: "Jueves de 18 a 20" }],
      });
      const reply = quickLookup(withPromos, "¿Qué promociones tienen?");
      expect(reply).toMatch(/2x1 en café/);
      expect(reply).toMatch(/Jueves de 18 a 20/);
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

  describe("dynamic API contexts", () => {
    it("normalizeDynamicSources filtra endpoints inválidos", () => {
      const normalized = normalizeDynamicSources([
        { name: "Precios", endpoint: " https://api.local/prices ", enabled: true },
        { name: "Mesas", endpoint: "https://api.local/tables", enabled: false },
        { name: "Sin endpoint", endpoint: "" },
        null,
      ]);

      expect(normalized).toHaveLength(1);
      expect(normalized[0]).toEqual({
        name: "Precios",
        endpoint: "https://api.local/prices",
        enabled: true,
      });
    });

    it("toDynamicContext agrega metadata updated_at al nombre", () => {
      const context = toDynamicContext("Precios", {
        updated_at: "2026-03-10T18:25:00Z",
        items: [{ id: "latte", price: 3800 }],
      });

      expect(context.name).toContain("Precios");
      expect(context.name).toContain("2026-03-10T18:25:00Z");
      expect(context.content).toContain("latte");
    });

    it("fetchDynamicContexts devuelve contextos exitosos y errores", async () => {
      const mockFetch = vi.fn(async (url) => {
        if (url.includes("prices")) {
          return {
            ok: true,
            json: async () => ({ updated_at: "2026-03-10T18:25:00Z", items: [] }),
          };
        }

        return {
          ok: false,
          status: 503,
          json: async () => ({}),
        };
      });

      const result = await fetchDynamicContexts(
        [
          { name: "Precios", endpoint: "https://api.local/prices", enabled: true },
          { name: "Mesas", endpoint: "https://api.local/tables", enabled: true },
        ],
        mockFetch
      );

      expect(result.contexts).toHaveLength(1);
      expect(result.contexts[0].name).toContain("Precios");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].name).toBe("Mesas");
    });
  });

  describe("generateChatSummary", () => {
    function makeMessages(pairs) {
      const msgs = [{ id: "0", author: "Bot", text: "Hola, ¿en qué puedo ayudarte?" }];
      let id = 1;
      for (const [user, bot] of pairs) {
        msgs.push({ id: String(id++), author: "Cliente", text: user });
        msgs.push({ id: String(id++), author: "Bot", text: bot, pending: false, streaming: false });
      }
      return msgs;
    }

    it("devuelve vacío si hay 2 mensajes o menos", () => {
      expect(generateChatSummary([{ author: "Bot", text: "Hola" }])).toBe("");
      expect(generateChatSummary(makeMessages([]))).toBe("");
    });

    it("incluye la última interacción verbatim", () => {
      const msgs = makeMessages([["¿Cuál es el horario?", "Lunes a viernes de 8 a 20."]]);
      const summary = generateChatSummary(msgs);
      expect(summary).toContain("¿Cuál es el horario?");
      expect(summary).toContain("Lunes a viernes de 8 a 20.");
    });

    it("extrae el nombre del cliente mencionado", () => {
      const msgs = makeMessages([
        ["Me llamo Juan, ¿cuál es el horario?", "Lunes a viernes de 8 a 20."],
      ]);
      const summary = generateChatSummary(msgs);
      expect(summary).toMatch(/Juan/i);
    });

    it("extrae ítems pedidos por el cliente", () => {
      const msgs = makeMessages([
        ["Quiero un café con leche por favor", "¡Claro! Ya te lo traemos."],
      ]);
      const summary = generateChatSummary(msgs);
      expect(summary.toLowerCase()).toContain("café");
    });

    it("extrae temas consultados de las interacciones antiguas y los deduplica", () => {
      // 5 pares: 2 viejas (irán al resumen) + 3 recientes (verbatim).
      // La dedupe de horario debe verse en el bloque "Consultó sobre:".
      const msgs = makeMessages([
        ["¿Cuál es el horario?", "Lunes a viernes de 8 a 20."],
        ["¿Y el teléfono?", "Es el +54 11 4567 8899."],
        ["¿Cuál es el horario de los sábados?", "Sábados de 9 a 23."],
        ["¿Tienen WiFi?", "Sí, red CafeCentral_Guest, clave cafecentral2026."],
        ["¿Aceptan mascotas?", "Sí, en mesas de exterior."],
      ]);
      const summary = generateChatSummary(msgs, 800);
      const topicsLine = summary.split("\n").find((l) => l.includes("Consultó sobre"));
      expect(topicsLine).toBeDefined();
      // "horario" debería aparecer una sola vez en la lista de temas.
      const horarioCount = (topicsLine || "").split("horario").length - 1;
      expect(horarioCount).toBe(1);
      expect(summary).toContain("teléfono");
    });

    it("poda tópicos cuando se supera el presupuesto de tokens", () => {
      const manyPairs = Array.from({ length: 20 }, (_, i) => [
        `¿Cuál es el horario del día ${i}? Y el teléfono y la dirección y el menú`,
        `Respuesta ${i}.`,
      ]);
      const msgs = makeMessages(manyPairs);
      const summary = generateChatSummary(msgs, 80); // very tight budget
      expect(summary.length).toBeGreaterThan(0);
      // Should never exceed the budget by a large margin
      // (token estimate: ~chars/4, so 80 tokens ≈ 320 chars)
      expect(summary.length).toBeLessThan(800);
    });

    it("siempre preserva la última interacción aunque se pode todo lo demás", () => {
      const msgs = makeMessages([
        ["Me llamo Pedro y quiero saber el horario, el teléfono y la dirección", "Respondido."],
        ["¿Y las formas de pago?", "Efectivo y tarjeta."],
      ]);
      const summary = generateChatSummary(msgs, 50); // extremely tight
      // Con rolling window (3 recientes por defecto) y solo 2 interacciones,
      // las 2 son «recientes». Con budget muy chico, la más vieja (primera
      // interacción) puede truncarse, pero la última siempre debe sobrevivir.
      expect(summary).toContain("¿Y las formas de pago?");
    });
  });

  describe("computeHistoryBudget", () => {
    it("devuelve al menos 150 tokens incluso cuando el contexto fijo supera la ventana", () => {
      const budget = computeHistoryBudget({
        contextWindowSize: 512,           // small window
        businessInfo: "x".repeat(10000), // ~2500 tokens — far exceeds the window
        maxTokens: 128,
        additionalContexts: [],
      });
      expect(budget).toBe(150);
    });

    it("reduce el presupuesto cuando hay contextos adicionales", () => {
      const base = computeHistoryBudget({ contextWindowSize: 4096, businessInfo: "", additionalContexts: [], maxTokens: 128 });
      const withExtra = computeHistoryBudget({
        contextWindowSize: 4096,
        businessInfo: "",
        additionalContexts: [{ content: "x".repeat(1600) }], // ~400 tokens
        maxTokens: 128,
      });
      expect(withExtra).toBeLessThan(base);
    });

    it("usa los valores por defecto de DEFAULT_CONFIG si no se pasan parámetros", () => {
      const budget = computeHistoryBudget({});
      expect(budget).toBeGreaterThan(150);
    });
  });

  describe("generateChatSummary — rolling window", () => {
    function makeMsgs(pairs) {
      const msgs = [{ id: "0", author: "Bot", text: "Hola" }];
      let id = 1;
      for (const [user, bot] of pairs) {
        msgs.push({ id: String(id++), author: "Cliente", text: user });
        msgs.push({ id: String(id++), author: "Bot", text: bot, pending: false, streaming: false });
      }
      return msgs;
    }

    it("con pocas interacciones todas van verbatim (sin resumen)", () => {
      const msgs = makeMsgs([
        ["¿Horario?", "8 a 20."],
        ["¿Teléfono?", "+54 11 4567."],
      ]);
      const summary = generateChatSummary(msgs, 800);
      expect(summary).toContain("¿Horario?");
      expect(summary).toContain("8 a 20.");
      expect(summary).toContain("¿Teléfono?");
      // No hay sección de resumen de la charla anterior con 2 pares.
      expect(summary).not.toContain("Resumen de la charla anterior");
    });

    it("con muchas interacciones: las viejas van al resumen, las recientes verbatim", () => {
      // Las viejas deben tener hechos extraíbles (nombre, pedido, tema) para
      // que la sección «Resumen de la charla anterior» se genere.
      const pairs = [
        ["Me llamo Carlos y quiero saber el horario", "Lunes a viernes 8 a 20."],
        ["¿Aceptan tarjeta?", "Sí, débito y crédito."],
        ["¿Y la dirección?", "Av. Corrientes 1234."],
        ["¿Tienen WiFi?", "Sí, red CafeCentral_Guest."],
        ["¿Cuál es el teléfono?", "+54 11 4567 8899."],
        ["¿Tienen opciones vegetarianas?", "Sí, varias."],
        ["¿Delivery?", "Sí, en CABA."],
        ["¿Reservas?", "Sí, por la web."],
        ["¿Hacen factura?", "Factura A y B."],
        ["¿WiFi tiene clave?", "Sí, cafecentral2026."],
      ];
      // Las últimas 3 son las «recientes».
      const recent = [
        ["¿Están abiertos hoy?", "Sí, hasta las 20."],
        ["¿Tienen mesa afuera?", "Sí, son pet friendly."],
        ["¿Cómo cancelo?", "Con 2 horas de anticipación."],
      ];
      const msgs = makeMsgs([...pairs, ...recent]);
      // Budget grande: el resumen y las 3 recientes entran.
      const summary = generateChatSummary(msgs, 1200);

      // Resumen de la charla anterior (10 viejas con hechos extraíbles)
      expect(summary).toContain("Resumen de la charla anterior");
      expect(summary).toMatch(/Carlos/);
      // Las 3 recientes verbatim
      expect(summary).toContain("¿Están abiertos hoy?");
      expect(summary).toContain("¿Tienen mesa afuera?");
      expect(summary).toContain("¿Cómo cancelo?");
    });

    it("con budget chico se priorizan las recientes verbatim por sobre el resumen", () => {
      const pairs = [];
      for (let i = 0; i < 10; i++) {
        pairs.push([`Pregunta vieja ${i}`, `Respuesta vieja ${i}`]);
      }
      const recent = [
        ["¿Están abiertos hoy?", "Sí, hasta las 20."],
        ["¿Tienen mesa afuera?", "Sí, son pet friendly."],
        ["¿Cómo cancelo?", "Con 2 horas de anticipación."],
      ];
      const msgs = makeMsgs([...pairs, ...recent]);
      // Budget chico: priorizamos las recientes.
      const summary = generateChatSummary(msgs, 350);
      expect(summary).toContain("¿Cómo cancelo?");
      // El resumen de viejas puede no entrar — eso es esperado.
    });

    it("respeta el maxResponseChars y maxQuestionChars en las recientes", () => {
      const longBot = "a".repeat(2000);
      const longUser = "u".repeat(500);
      const msgs = makeMsgs([[longUser, longBot]]);
      const summary = generateChatSummary(msgs, 400, {
        maxResponseChars: 100,
        maxQuestionChars: 50,
      });
      // La respuesta del bot se trunca a 100 chars.
      expect(summary).toContain("a".repeat(50)); // hay al menos 50 'a'
      // El bloque completo no debe contener las 2000 'a'.
      const aCount = (summary.match(/a/g) || []).length;
      expect(aCount).toBeLessThan(2000);
    });

    it("preserva el nombre del cliente aunque la última pregunta no lo mencione", () => {
      const msgs = makeMsgs([
        ["Me llamo Ana y quiero el horario", "De 8 a 20."],
        ["¿Y la dirección?", "Av. Corrientes 1234."],
        ["¿Tienen WiFi?", "Sí."],
        ["¿Mascotas?", "Sí, afuera."],
      ]);
      const summary = generateChatSummary(msgs, 600);
      // Ana debería aparecer en el resumen (las 3 recientes no la mencionan).
      expect(summary).toMatch(/Ana/);
    });
  });

  describe("estimateContextOverflow", () => {
    it("no overflow cuando hay espacio de sobra", () => {
      const result = estimateContextOverflow(
        { totalTokens: 500 },
        4096
      );
      expect(result.overflow).toBe(false);
      expect(result.nearLimit).toBe(false);
      expect(result.percent).toBe(12);
      expect(result.free).toBe(3596);
    });

    it("marca nearLimit cuando > 80%", () => {
      const result = estimateContextOverflow({ totalTokens: 3500 }, 4096);
      expect(result.overflow).toBe(false);
      expect(result.nearLimit).toBe(true);
      expect(result.percent).toBe(85);
    });

    it("marca overflow cuando > 100%", () => {
      const result = estimateContextOverflow({ totalTokens: 4500 }, 4096);
      expect(result.overflow).toBe(true);
      expect(result.nearLimit).toBe(true);
      expect(result.percent).toBe(110);
    });

    it("maneja entradas inválidas sin romper", () => {
      expect(estimateContextOverflow(null, 4096)).toEqual({
        overflow: false,
        percent: 0,
        free: 4096,
      });
      expect(estimateContextOverflow({}, 0)).toEqual({
        overflow: false,
        percent: 0,
        free: 0,
      });
    });
  });

  describe("summarizeChatWithModel", () => {
    function makeMsgs(pairs) {
      const msgs = [{ id: "0", author: "Bot", text: "Hola" }];
      let id = 1;
      for (const [user, bot] of pairs) {
        msgs.push({ id: String(id++), author: "Cliente", text: user });
        msgs.push({ id: String(id++), author: "Bot", text: bot, pending: false, streaming: false });
      }
      return msgs;
    }

    it("devuelve string vacío si no hay engine", async () => {
      const result = await summarizeChatWithModel(null, makeMsgs([["hola", "chau"]]));
      expect(result).toBe("");
    });

    it("devuelve string vacío si los mensajes son muy cortos", async () => {
      const result = await summarizeChatWithModel(
        { chat: { completions: { create: vi.fn() } } },
        makeMsgs([])
      );
      expect(result).toBe("");
    });

    it("llama al engine y devuelve el resumen con el prefijo estándar", async () => {
      const engine = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: "Cliente pidió un café, consultó horarios." } }],
            }),
          },
        },
      };
      const result = await summarizeChatWithModel(
        engine,
        makeMsgs([
          ["Hola, ¿cuál es el horario?", "De 8 a 20."],
          ["Quiero un café con leche", "Perfecto, enseguida."],
        ])
      );
      expect(result).toContain("Resumen de la charla (comprimido):");
      expect(result).toContain("café");
      expect(engine.chat.completions.create).toHaveBeenCalled();
      // El segundo arg debe ser el transcript con ambas interacciones.
      const callArgs = engine.chat.completions.create.mock.calls[0][0];
      const userMessage = callArgs.messages[1].content;
      expect(userMessage).toContain("¿cuál es el horario");
      expect(userMessage).toContain("café con leche");
    });

    it("devuelve null si el engine responde vacío (caller usa fallback)", async () => {
      const engine = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: "" } }],
            }),
          },
        },
      };
      const result = await summarizeChatWithModel(engine, makeMsgs([["hola", "chau"]]));
      expect(result).toBeNull();
    });

    it("devuelve null si el engine tira error", async () => {
      const engine = {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error("GPU saturada")),
          },
        },
      };
      const result = await summarizeChatWithModel(engine, makeMsgs([["hola", "chau"]]));
      expect(result).toBeNull();
    });
  });

  describe("getCurrentContextInfo", () => {
    it("devuelve fecha, hora y día formateados en español para una fecha fija", () => {
      const ctx = getCurrentContextInfo(
        new Date("2026-06-11T14:30:00Z"),
        "UTC"
      );

      expect(ctx.dia_semana).toBe("jueves");
      expect(ctx.hora).toBe("14:30");
      expect(ctx.fecha).toContain("11 de junio de 2026");
      expect(ctx.es_fin_de_semana).toBe(false);
      expect(ctx.zona_horaria).toBe("UTC");
    });

    it("marca sábado y domingo como fin de semana", () => {
      const sat = getCurrentContextInfo(new Date("2026-06-13T10:00:00Z"), "UTC");
      const sun = getCurrentContextInfo(new Date("2026-06-14T10:00:00Z"), "UTC");
      expect(sat.es_fin_de_semana).toBe(true);
      expect(sun.es_fin_de_semana).toBe(true);
    });

    it("respeta una zona horaria distinta (UTC-3 → resta 3h)", () => {
      const ctx = getCurrentContextInfo(
        new Date("2026-06-11T17:30:00Z"),
        "America/Argentina/Buenos_Aires"
      );

      // 17:30 UTC = 14:30 en Buenos Aires
      expect(ctx.hora).toBe("14:30");
      expect(ctx.zona_horaria).toBe("America/Argentina/Buenos_Aires");
    });

    it("produce un bloque compacto (<200 caracteres)", () => {
      const ctx = getCurrentContextInfo(
        new Date("2026-06-11T14:30:00Z"),
        "UTC"
      );
      const serialized = JSON.stringify(ctx);
      expect(serialized.length).toBeLessThan(200);
    });
  });

  describe("quickLookup — nuevos paths", () => {
    const fullDoc = JSON.stringify({
      local: {
        nombre: "Café Central",
        telefono: "+54 11 4567 8899",
        wifi: {
          disponible: true,
          red: "CafeCentral_Guest",
          password: "cafecentral2026",
        },
        politicas: {
          cancelacion_reservas: "Cancelar con al menos 2 horas de anticipación por WhatsApp o teléfono.",
          facturacion: "Factura A y B. Solicitar al momento del pago.",
        },
      },
      horarios: {
        regular: { lunes: "08:00 - 20:00" },
        cocina_cierra: "30 minutos antes del cierre del local",
      },
      servicios: { delivery: true, reservas: true, reservas_canal: "sitio web, WhatsApp o teléfono" },
      menu: {
        moneda: "ARS",
        destacados: [
          { nombre: "Avocado Toast", precio: 7800 },
          { nombre: "Cappuccino", precio: 3200 },
        ],
        categorias: { cafes: [], brunch: [], pasteleria: [], almuerzos: [] },
      },
      recomendaciones_por_dia: {
        lunes: "Tranquilo, ideal para trabajar.",
        sabado: "Día pico. Sugerimos reservar.",
      },
    });

    it("devuelve la contraseña de WiFi cuando preguntan por la clave", () => {
      const reply = quickLookup(fullDoc, "¿Cuál es la clave del WiFi?");
      expect(reply).toContain("CafeCentral_Guest");
      expect(reply).toContain("cafecentral2026");
    });

    it("devuelve la política de cancelación cuando preguntan cómo cancelar", () => {
      const reply = quickLookup(fullDoc, "¿Cómo cancelo una reserva?");
      expect(reply).toContain("2 horas de anticipación");
    });

    it("devuelve la política de facturación cuando preguntan por factura", () => {
      const reply = quickLookup(fullDoc, "¿Hacen factura A?");
      expect(reply).toContain("Factura A y B");
    });

    it("devuelve el horario de cocina cuando preguntan por la cocina", () => {
      const reply = quickLookup(fullDoc, "¿A qué hora cierra la cocina?");
      expect(reply).toContain("30 minutos antes del cierre");
    });

    it("devuelve recomendaciones de día cuando preguntan qué día conviene", () => {
      const reply = quickLookup(fullDoc, "¿Qué día conviene venir?");
      expect(reply).toContain("lunes: Tranquilo");
      expect(reply).toContain("sabado: Día pico");
    });

    it("devuelve los destacados del menú cuando preguntan qué recomiendan", () => {
      const reply = quickLookup(fullDoc, "¿Qué me recomendás?");
      expect(reply).toContain("Avocado Toast");
      expect(reply).toContain("Cappuccino");
    });

    it("lista las categorías cuando preguntan por la carta", () => {
      const reply = quickLookup(fullDoc, "¿Tienen carta?");
      expect(reply).toContain("cafes");
      expect(reply).toContain("brunch");
    });

    it("incluye el canal de reservas en la respuesta de reservas", () => {
      const reply = quickLookup(fullDoc, "¿Aceptan reservas?");
      expect(reply).toContain("sitio web");
    });
  });
});