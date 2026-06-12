import { beforeEach, describe, expect, it } from "vitest";

import { createHashedEmbedder, cosineSimilarity } from "./embeddings";
import { createInMemorySemanticStore } from "./semanticStore";
import { createSemanticMemory } from "./semanticMemory";
import { extractFacts } from "./factExtraction";
import { createConversationBuffer, pushInteraction, renderConversationBuffer } from "./conversationBuffer";
import { createWorkingMemory, updateWorkingMemory, renderWorkingMemory } from "./workingMemory";
import { createLongTermMemory, pruneLongTermMemory, renderLongTermMemory, upsertFact } from "./longTermMemory";
import { optimizeLongTermFacts } from "./memoryOptimizer";
import { allocateMemoryBudget, estimateTokens } from "./tokenBudget";
import { createMemoryManager } from "./memoryManager";

describe("embeddings (hashed)", () => {
  const embedder = createHashedEmbedder();

  it("produce vectores determinísticos y normalizados", () => {
    const a = embedder.embed("¿Cuál es el horario de apertura?");
    const b = embedder.embed("¿Cuál es el horario de apertura?");
    expect(Array.from(a)).toEqual(Array.from(b));

    let norm = 0;
    for (const v of a) norm += v * v;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  it("textos relacionados puntúan más alto que textos sin relación", () => {
    const query = embedder.embed("horario de apertura del local");
    const related = embedder.embed("¿a qué hora abre el local? horarios");
    const unrelated = embedder.embed("quiero pedir una pizza grande con extra queso");

    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated));
  });

  it("texto vacío produce vector cero con similitud 0", () => {
    const empty = embedder.embed("");
    expect(cosineSimilarity(empty, embedder.embed("hola"))).toBe(0);
  });
});

describe("extractFacts", () => {
  it("extrae nombre, alergia y pedido", () => {
    const { longTerm } = extractFacts("Hola, me llamo Diego, soy alérgico al maní y quiero un cortado");
    const paths = longTerm.map((f) => f.path);
    expect(paths).toContain("cliente.nombre");
    expect(paths).toContain("cliente.alergias");
    expect(paths).toContain("pedidos.recientes");

    const allergy = longTerm.find((f) => f.path === "cliente.alergias");
    expect(allergy.importance).toBe(10);
    expect(allergy.value).toMatch(/maní/);
  });

  it("«soy vegetariano» no se confunde con nombre", () => {
    const { longTerm } = extractFacts("soy vegetariano, ¿qué opciones tienen?");
    expect(longTerm.find((f) => f.path === "cliente.nombre")).toBeUndefined();
    expect(longTerm.find((f) => f.path === "cliente.dieta")?.value).toBe("vegetariano");
  });

  it("detecta temas y respuestas sin resolver", () => {
    const result = extractFacts("¿Qué promociones tienen?", "Por el momento no tengo esa información.");
    expect(result.topics).toContain("promociones");
    expect(result.unresolved).toBe(true);
  });

  it("marca saludos puros como triviales", () => {
    expect(extractFacts("hola!").trivial).toBe(true);
    expect(extractFacts("hola, ¿cuál es el horario?").trivial).toBe(false);
  });
});

describe("conversationBuffer", () => {
  it("mantiene solo los últimos maxPairs", () => {
    const buffer = createConversationBuffer({ maxPairs: 3 });
    for (let i = 1; i <= 5; i++) {
      pushInteraction(buffer, { question: `pregunta ${i}`, answer: `respuesta ${i}` });
    }
    expect(buffer.pairs).toHaveLength(3);
    expect(buffer.pairs[0].question).toBe("pregunta 3");
    expect(buffer.pairs[2].question).toBe("pregunta 5");
  });

  it("respeta el presupuesto priorizando lo más reciente", () => {
    const buffer = createConversationBuffer({ maxPairs: 8 });
    for (let i = 1; i <= 8; i++) {
      pushInteraction(buffer, {
        question: `pregunta número ${i} con bastante texto adicional para ocupar`,
        answer: `respuesta número ${i} también con contenido extendido para sumar tokens`,
      });
    }
    const rendered = renderConversationBuffer(buffer, 60);
    expect(estimateTokens(rendered)).toBeLessThanOrEqual(60);
    expect(rendered).toContain("número 8");
    expect(rendered).not.toContain("número 1");
  });

  it("presupuesto cero devuelve vacío", () => {
    const buffer = createConversationBuffer();
    pushInteraction(buffer, { question: "hola", answer: "buenas" });
    expect(renderConversationBuffer(buffer, 0)).toBe("");
  });
});

describe("workingMemory", () => {
  it("trackea tema actual y temas activos sin duplicar", () => {
    const wm = createWorkingMemory();
    updateWorkingMemory(wm, { question: "¿horario?", topics: ["horario"] });
    updateWorkingMemory(wm, { question: "¿menú?", topics: ["menú"] });
    updateWorkingMemory(wm, { question: "¿y el horario del domingo?", topics: ["horario"] });

    expect(wm.temaActual).toBe("horario");
    expect(wm.temasActivos).toEqual(["menú", "horario"]);
  });

  it("registra y limpia preguntas sin resolver", () => {
    const wm = createWorkingMemory();
    updateWorkingMemory(wm, {
      question: "¿tienen promociones de verano?",
      topics: ["promociones"],
      unresolved: true,
    });
    expect(wm.pendientes).toHaveLength(1);

    updateWorkingMemory(wm, { question: "¿promociones?", topics: ["promociones"], unresolved: false });
    expect(wm.pendientes).toHaveLength(0);
  });

  it("render respeta presupuesto descartando lo menos prioritario", () => {
    const wm = createWorkingMemory();
    updateWorkingMemory(wm, { question: "a", topics: ["horario", "menú", "delivery"] });
    updateWorkingMemory(wm, { question: "pregunta larga sin resolver", topics: [], unresolved: true });

    const full = renderWorkingMemory(wm, 200);
    expect(full).toContain("tema_actual");
    expect(full).toContain("sin_resolver");

    const tight = renderWorkingMemory(wm, 8);
    expect(estimateTokens(tight)).toBeLessThanOrEqual(8);
  });
});

describe("longTermMemory", () => {
  it("deduplica hechos repetidos reforzando confianza", () => {
    const ltm = createLongTermMemory();
    upsertFact(ltm, { path: "cliente.nombre", value: "Diego", importance: 9, confidence: 0.8 });
    upsertFact(ltm, { path: "cliente.nombre", value: "diego", importance: 9, confidence: 0.8 });

    expect(Object.keys(ltm.facts)).toHaveLength(1);
    expect(ltm.facts["cliente.nombre"].count).toBe(2);
    expect(ltm.facts["cliente.nombre"].confidence).toBeCloseTo(0.9);
  });

  it("un valor nuevo reemplaza al obsoleto en paths escalares", () => {
    const ltm = createLongTermMemory();
    upsertFact(ltm, { path: "cliente.nombre", value: "Diego", importance: 9 });
    upsertFact(ltm, { path: "cliente.nombre", value: "Marcos", importance: 9 });
    expect(ltm.facts["cliente.nombre"].value).toBe("Marcos");
  });

  it("paths de lista acumulan valores únicos", () => {
    const ltm = createLongTermMemory();
    upsertFact(ltm, { path: "pedidos.items", value: "cortado" });
    upsertFact(ltm, { path: "pedidos.items", value: "medialunas" });
    upsertFact(ltm, { path: "pedidos.items", value: "Cortado" });
    expect(ltm.facts["pedidos.items"].values).toEqual(["cortado", "medialunas"]);
  });

  it("la poda nunca elimina hechos críticos (importance >= 9)", () => {
    const ltm = createLongTermMemory();
    upsertFact(ltm, { path: "cliente.alergias", value: "maní", importance: 10 });
    for (let i = 0; i < 10; i++) {
      upsertFact(ltm, { path: `tema.menor${i}`, value: `dato ${i}`, importance: 3 });
    }
    pruneLongTermMemory(ltm, { maxFacts: 4 });
    expect(ltm.facts["cliente.alergias"]).toBeDefined();
    expect(Object.keys(ltm.facts).length).toBeLessThanOrEqual(4);
  });

  it("render agrupa por raíz y respeta presupuesto", () => {
    const ltm = createLongTermMemory();
    upsertFact(ltm, { path: "cliente.nombre", value: "Diego", importance: 9 });
    upsertFact(ltm, { path: "cliente.alergias", value: "maní", importance: 10 });
    upsertFact(ltm, { path: "pedidos.items", value: "cortado", importance: 5 });

    const text = renderLongTermMemory(ltm, 200);
    expect(text).toMatch(/cliente: .*nombre=Diego/);
    expect(text).toMatch(/alergias=maní/);
    expect(text).toMatch(/pedidos: items=cortado/);

    // Presupuesto chico: sobrevive la línea más importante (cliente).
    const tight = renderLongTermMemory(ltm, estimateTokens("cliente: alergias=maní; nombre=Diego") + 1);
    expect(tight).toContain("cliente:");
  });
});

describe("memoryOptimizer", () => {
  it("normaliza, deduplica y elimina ruido", () => {
    const ltm = createLongTermMemory();
    ltm.facts["pedidos.items"] = {
      path: "pedidos.items",
      values: ["cortado.", "  Cortado", "hola", "medialunas"],
      importance: 5,
      confidence: 0.8,
      lastUpdated: Date.now(),
      accessCount: 0,
      count: 4,
    };
    ltm.facts["ruido.puro"] = {
      path: "ruido.puro",
      value: "gracias",
      importance: 3,
      confidence: 0.5,
      lastUpdated: Date.now(),
      accessCount: 0,
      count: 1,
    };

    const removed = optimizeLongTermFacts(ltm);
    expect(removed).toBeGreaterThan(0);
    expect(ltm.facts["pedidos.items"].values).toEqual(["cortado", "medialunas"]);
    expect(ltm.facts["ruido.puro"]).toBeUndefined();
  });
});

describe("tokenBudget", () => {
  it("reparte el presupuesto entre capas según ratios", () => {
    const budgets = allocateMemoryBudget(1000);
    expect(budgets.recent).toBeGreaterThan(budgets.working);
    const total = budgets.working + budgets.longTerm + budgets.semantic + budgets.recent;
    expect(total).toBeLessThanOrEqual(1000 + 4); // redondeos
  });

  it("presupuesto mínimo va todo al buffer reciente", () => {
    const budgets = allocateMemoryBudget(50);
    expect(budgets.recent).toBe(50);
    expect(budgets.working).toBe(0);
  });
});

describe("semanticMemory", () => {
  let semantic;

  beforeEach(() => {
    semantic = createSemanticMemory({
      store: createInMemorySemanticStore(),
      embedder: createHashedEmbedder(),
      maxEntries: 10,
    });
  });

  it("recuerda y recupera por similitud con umbral", async () => {
    await semantic.remember({ text: "Cliente preguntó por el horario de apertura del local", importance: 5 });
    await semantic.remember({ text: "Cliente pidió un cortado con medialunas", importance: 6 });

    const results = await semantic.recall("¿a qué hora abren?", { topK: 2, minSimilarity: 0.2 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toContain("horario");
  });

  it("refuerza entradas casi duplicadas en lugar de duplicar", async () => {
    await semantic.remember({ text: "Cliente preguntó por el horario de apertura del local" });
    await semantic.remember({ text: "Cliente preguntó por el horario de apertura del local" });
    expect(await semantic.size()).toBe(1);
  });

  it("ignora textos sin sustancia", async () => {
    expect(await semantic.remember({ text: "hola" })).toBeNull();
  });

  it("compact poda hasta el cap sin tocar entradas críticas", async () => {
    for (let i = 0; i < 14; i++) {
      await semantic.remember({
        text: `Interacción número ${i} sobre un tema distinto: ${["pizza", "vino", "postre", "reserva", "terraza", "factura", "cumpleaños", "evento", "música", "estacionamiento", "menú infantil", "café de especialidad", "brunch", "torta"][i]}`,
        importance: i === 0 ? 10 : 4,
      });
    }
    await semantic.compact();
    expect(await semantic.size()).toBeLessThanOrEqual(10);
    const results = await semantic.recall("pizza", { topK: 1, minSimilarity: 0.1 });
    expect(results[0]?.text).toContain("pizza");
  });
});

describe("memoryManager (end-to-end)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function createManager(overrides = {}) {
    return createMemoryManager({
      storageKey: "test-memory",
      semanticStore: createInMemorySemanticStore(),
      compactEvery: 5,
      maxRecentPairs: 4,
      ...overrides,
    });
  }

  it("el contexto queda acotado al presupuesto aunque haya cientos de interacciones", async () => {
    const manager = createManager();
    for (let i = 0; i < 120; i++) {
      await manager.recordInteraction({
        question: `Pregunta número ${i} sobre el tema ${i % 7}: ¿qué me recomendás del menú para hoy?`,
        answer: `Respuesta número ${i} con la recomendación del día y bastante texto para simular una respuesta real del asistente.`,
      });
    }

    const budget = 400;
    const context = await manager.buildMemoryContext("¿qué me recomendás?", budget);
    expect(estimateTokens(context)).toBeLessThanOrEqual(budget);
    expect(context).toContain("Conversación reciente:");
    expect(manager.getStats().bufferPairs).toBe(4);
  });

  it("recuerda hechos críticos mucho después de que salieron del buffer", async () => {
    const manager = createManager();
    await manager.recordInteraction({
      question: "Me llamo Diego y soy alérgico al maní",
      answer: "¡Encantado, Diego! Lo tendré en cuenta.",
    });
    // 30 interacciones después, el buffer (4 pares) ya no tiene el dato.
    for (let i = 0; i < 30; i++) {
      await manager.recordInteraction({
        question: `Consulta de relleno ${i} sobre horarios y menú del día`,
        answer: `Respuesta de relleno ${i}.`,
      });
    }

    const context = await manager.buildMemoryContext("¿me recomendás algo con frutos secos?", 600);
    expect(context).toContain("nombre=Diego");
    expect(context).toMatch(/alergias=.*maní/);
  });

  it("compacta automáticamente cada compactEvery interacciones", async () => {
    const manager = createManager({ compactEvery: 3 });
    let compactions = 0;
    for (let i = 0; i < 9; i++) {
      const { compacted } = await manager.recordInteraction({
        question: `Pregunta variada número ${i} sobre el local`,
        answer: `Respuesta ${i}`,
      });
      if (compacted) compactions++;
    }
    expect(compactions).toBe(3);
  });

  it("persiste y restaura working/long-term/buffer entre sesiones", async () => {
    const first = createManager();
    await first.recordInteraction({
      question: "Me llamo Ana, ¿cuál es el horario?",
      answer: "Hola Ana, abrimos a las 8.",
    });

    const second = createManager(); // misma storageKey → restaura
    const context = await second.buildMemoryContext("¿cómo me llamo?", 500);
    expect(context).toContain("nombre=Ana");
    expect(second.getStats().interactionCount).toBe(1);
  });

  it("reset limpia todas las capas", async () => {
    const manager = createManager();
    await manager.recordInteraction({ question: "Me llamo Ana", answer: "Hola Ana" });
    await manager.reset();
    expect(manager.getStats()).toEqual({ interactionCount: 0, bufferPairs: 0, longTermFacts: 0 });
    expect(await manager.buildMemoryContext("¿cómo me llamo?", 500)).toBe("");
  });
});
