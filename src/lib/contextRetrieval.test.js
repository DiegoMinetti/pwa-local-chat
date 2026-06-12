import { describe, expect, it } from "vitest";
import { matchBusinessSections, selectRelevantBusinessInfo } from "./contextRetrieval";

const BUSINESS_DOC = JSON.stringify({
  metadata: { version: "1.0", descripcion_dataset: "interno" },
  intenciones_soportadas: ["horarios", "menu"],
  local: { nombre: "Café Central", telefono: "+54 11 4567 8899" },
  horarios: { regular: { lunes: "08:00 - 20:00", domingo: "09:00 - 20:00" } },
  sucursales: [{ nombre: "Centro", direccion: "Av. Corrientes 1234" }],
  servicios: { medios_de_pago: ["efectivo", "tarjeta"], delivery: true },
  menu: { cafeteria: [{ item: "espresso", precio: 2500 }] },
  dietas_y_opciones: { vegano: true, sin_gluten: true },
  faq: [{ pregunta: "¿Aceptan reservas?", respuesta: "Sí, por teléfono." }],
  tiempos_promedio: { cafe_min: 5 },
});

describe("matchBusinessSections", () => {
  it("detecta horarios", () => {
    expect(matchBusinessSections("¿A qué hora abren los sábados?")).toContain("horarios");
  });

  it("detecta ubicación con acentos", () => {
    expect(matchBusinessSections("¿Cuál es la dirección?")).toContain("sucursales");
  });

  it("detecta medios de pago", () => {
    expect(matchBusinessSections("¿Puedo pagar con tarjeta?")).toContain("servicios");
  });

  it("detecta menú y precios", () => {
    expect(matchBusinessSections("¿Cuánto cuesta el café?")).toContain("menu");
  });

  it("devuelve vacío sin coincidencias", () => {
    expect(matchBusinessSections("gracias por todo")).toEqual([]);
  });
});

describe("selectRelevantBusinessInfo", () => {
  it("incluye solo secciones relevantes más identidad y faq", () => {
    const result = JSON.parse(
      selectRelevantBusinessInfo(BUSINESS_DOC, "¿A qué hora cierran?", 1200)
    );

    expect(result.horarios).toBeDefined();
    expect(result.local).toBeDefined();
    expect(result.faq).toBeDefined();
    expect(result.menu).toBeUndefined();
    expect(result.sucursales).toBeUndefined();
  });

  it("nunca incluye metadata ni intenciones", () => {
    const result = JSON.parse(
      selectRelevantBusinessInfo(BUSINESS_DOC, "una consulta cualquiera", 5000)
    );

    expect(result.metadata).toBeUndefined();
    expect(result.intenciones_soportadas).toBeUndefined();
  });

  it("sin match usa el set por defecto y completa con el resto si hay presupuesto", () => {
    const result = JSON.parse(
      selectRelevantBusinessInfo(BUSINESS_DOC, "una consulta cualquiera", 5000)
    );

    expect(result.local).toBeDefined();
    expect(result.horarios).toBeDefined();
    expect(result.servicios).toBeDefined();
    expect(result.faq).toBeDefined();
    expect(result.menu).toBeDefined();
  });

  it("respeta el presupuesto de tokens", () => {
    const budget = 80;
    const result = selectRelevantBusinessInfo(BUSINESS_DOC, "¿Dónde quedan?", budget);

    expect(Math.ceil(result.length / 4)).toBeLessThanOrEqual(budget + 10);
  });

  it("devuelve texto plano tal cual cuando no es JSON y entra en presupuesto", () => {
    const plain = "Café Central abre de 8 a 20.";
    expect(selectRelevantBusinessInfo(plain, "¿horario?", 500)).toBe(plain);
  });

  it("trunca texto plano largo al presupuesto", () => {
    const plain = Array.from({ length: 200 }, (_, i) => `línea informativa ${i}`).join("\n");
    const result = selectRelevantBusinessInfo(plain, "¿horario?", 100);

    expect(Math.ceil(result.length / 4)).toBeLessThanOrEqual(110);
    expect(result.length).toBeGreaterThan(0);
  });

  it("devuelve string vacío sin documento", () => {
    expect(selectRelevantBusinessInfo("", "¿horario?", 500)).toBe("");
  });
});
