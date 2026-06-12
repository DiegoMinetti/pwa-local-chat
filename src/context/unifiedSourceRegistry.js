/**
 * Registro unificado de fuentes BaseSource. Reemplaza el manejo separado
 * de `localSource` y `remoteRegistry` en el orchestrator.
 *
 *   const registry = createUnifiedSourceRegistry([local, ...remotes]);
 *   registry.list()            → ["negocio", "erp", "crm"]
 *   registry.getSource(name)   → BaseSource | null
 *   registry.nonEmpty()        → solo las que tienen datos
 *   registry.discoverSchemas() → { nombre: { collections, sections, ... } }
 *
 * El registro es polimórfico: las fuentes pueden ser sync o async en
 * `getSchema()`; el resultado se unifica con `Promise.all`.
 */

import { assertBaseSource } from "./baseSource";

export function createUnifiedSourceRegistry(sources = []) {
  const map = new Map();

  for (const source of sources) {
    assertBaseSource(source);
    const key = String(source.name).toLowerCase();
    if (map.has(key)) {
      throw new Error(`Fuente duplicada en el registro: '${source.name}'.`);
    }
    map.set(key, source);
  }

  return {
    /** Devuelve los nombres registrados (preservando capitalización). */
    list() {
      return [...map.values()].map((s) => s.name);
    },

    getSource(name) {
      if (!name) return null;
      return map.get(String(name).toLowerCase()) || null;
    },

    /** Solo las fuentes con datos — el router las prefiere. */
    nonEmpty() {
      return [...map.values()].filter((s) => !s.isEmpty);
    },

    has(name) {
      return map.has(String(name || "").toLowerCase());
    },

    get size() {
      return map.size;
    },

    /**
     * Descubre schemas en paralelo. Las fuentes sin `getSchema` se
     * excluyen del resultado (no rompen).
     */
    async discoverSchemas() {
      const result = {};
      await Promise.all(
        [...map.values()].map(async (source) => {
          if (typeof source.getSchema !== "function") return;
          try {
            const schema = await source.getSchema();
            if (schema) result[source.name] = schema;
          } catch {
            // best-effort
          }
        })
      );
      return result;
    },
  };
}
