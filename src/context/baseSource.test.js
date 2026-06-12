import { describe, it, expect } from "vitest";
import {
  assertBaseSource,
  createStaticSource,
  normalizeSearchResult,
} from "../context/baseSource";
import { createUnifiedSourceRegistry } from "../context/unifiedSourceRegistry";
import { createLocalSource } from "../context/localSource";
import { createRemoteSource } from "../context/remoteSource";

/**
 * Conformance test: misma forma, misma suite. localSource y remoteSource
 * deben ser intercambiables detrás de BaseSource.
 */

const fixture = {
  local: { nombre: "Café Central", tipo: "Cafetería" },
  horarios: { regular: { lunes: "8-18" } },
  menu: {
    destacados: [
      { id: "cafe_latte", nombre: "Café latte", precio: 3800 },
      { id: "medialuna", nombre: "Medialuna", precio: 1200 },
    ],
  },
  sucursales: [{ id: "centro", nombre: "Centro", direccion: "Av. Siempre Viva 742" }],
};

describe("assertBaseSource", () => {
  it("acepta un local source real", () => {
    const src = createLocalSource(fixture, { name: "negocio" });
    expect(() => assertBaseSource(src)).not.toThrow();
  });

  it("acepta un remote source real", () => {
    const src = createRemoteSource({ name: "erp", baseUrl: "https://erp.example.com" });
    expect(() => assertBaseSource(src)).not.toThrow();
  });

  it("rechaza objetos sin métodos requeridos", () => {
    expect(() => assertBaseSource({ name: "x", isEmpty: false })).toThrow(/search/);
    expect(() => assertBaseSource({ name: "x", isEmpty: false, search: 1, getItem: () => null })).toThrow(/función/);
    expect(() => assertBaseSource({})).toThrow();
  });

  it("rechaza name vacío", () => {
    expect(() => assertBaseSource({ name: "", isEmpty: false, search: () => ({}), getItem: () => null })).toThrow(/name/);
  });
});

describe("createStaticSource", () => {
  it("expone search, getItem, searchSections y getSchema", () => {
    const src = createStaticSource({ name: "demo", data: fixture });
    expect(src.name).toBe("demo");
    expect(src.isEmpty).toBe(false);

    const found = src.search("café");
    expect(found.items.length).toBeGreaterThan(0);

    const item = src.getItem("cafe_latte");
    expect(item?.nombre).toBe("Café latte");

    const sections = src.searchSections("lunes");
    expect(sections.items.some((s) => s.path === "horarios")).toBe(true);

    const schema = src.getSchema();
    expect(schema.collections.map((c) => c.path)).toContain("menu.destacados");
    expect(schema.sections.map((s) => s.path)).toContain("horarios");
  });

  it("isEmpty es true si no hay datos", () => {
    expect(createStaticSource({ name: "vacio", data: null }).isEmpty).toBe(true);
    expect(createStaticSource({ name: "vacio", data: {} }).isEmpty).toBe(true);
  });
});

describe("createUnifiedSourceRegistry", () => {
  it("registra y resuelve por nombre (case-insensitive)", () => {
    const local = createLocalSource(fixture, { name: "Negocio" });
    const remote = createRemoteSource({ name: "ERP", baseUrl: "https://erp.example.com" });
    const reg = createUnifiedSourceRegistry([local, remote]);

    expect(reg.list()).toEqual(["Negocio", "ERP"]);
    expect(reg.getSource("negocio")).toBe(local);
    expect(reg.getSource("NEGOCIO")).toBe(local);
    expect(reg.getSource("erp")).toBe(remote);
    expect(reg.getSource("otro")).toBeNull();
    expect(reg.size).toBe(2);
    expect(reg.has("Negocio")).toBe(true);
  });

  it("rechaza duplicados", () => {
    const a = createLocalSource(fixture, { name: "dup" });
    const b = createLocalSource(fixture, { name: "DUP" });
    expect(() => createUnifiedSourceRegistry([a, b])).toThrow(/duplicada/);
  });

  it("nonEmpty filtra fuentes vacías", () => {
    const vacia = createLocalSource(null, { name: "vacia" });
    const conData = createLocalSource(fixture, { name: "negocio" });
    const reg = createUnifiedSourceRegistry([vacia, conData]);
    expect(reg.nonEmpty().map((s) => s.name)).toEqual(["negocio"]);
  });

  it("discoverSchemas agrega solo lo que cada fuente expone", async () => {
    const local = createLocalSource(fixture, { name: "negocio" });
    const reg = createUnifiedSourceRegistry([local]);
    const schemas = await reg.discoverSchemas();
    expect(Object.keys(schemas)).toEqual(["negocio"]);
    expect(schemas.negocio.collections.map((c) => c.path)).toContain("menu.destacados");
  });
});

describe("normalizeSearchResult", () => {
  it("envuelve arrays en { items, total }", () => {
    expect(normalizeSearchResult([{ a: 1 }, { a: 2 }])).toEqual({ items: [{ a: 1 }, { a: 2 }], total: 2 });
  });
  it("pasa tal cual si ya es { items, total }", () => {
    expect(normalizeSearchResult({ items: [1], total: 1 })).toEqual({ items: [1], total: 1 });
  });
  it("defiende contra null/undefined", () => {
    expect(normalizeSearchResult(null)).toEqual({ items: [], total: 0 });
    expect(normalizeSearchResult(undefined)).toEqual({ items: [], total: 0 });
  });
});

/**
 * Conformance: el mismo set de aserciones pasa contra una fuente local y
 * una estática con el mismo dataset. Si una implementación diverge del
 * contrato, este test cae.
 */
describe("BaseSource conformance: local ↔ static", () => {
  const cases = [
    { name: "local", factory: () => createLocalSource(fixture, { name: "x" }) },
    { name: "static", factory: () => createStaticSource({ name: "x", data: fixture }) },
  ];

  for (const { name, factory } of cases) {
    describe(name, () => {
      it("search devuelve items con la key correcta", () => {
        const src = factory();
        const result = src.search("café");
        expect(Array.isArray(result.items)).toBe(true);
        expect(typeof result.total).toBe("number");
      });
      it("getItem(null) no rompe", () => {
        const src = factory();
        expect(src.getItem(null)).toBeNull();
      });
      it("searchSections(query vacía) devuelve vacío", () => {
        const src = factory();
        expect(src.searchSections("").items).toEqual([]);
      });
      it("getSchema devuelve name y listas", () => {
        const src = factory();
        const schema = src.getSchema();
        expect(schema.name).toBe("x");
        expect(Array.isArray(schema.collections)).toBe(true);
      });
    });
  }
});
