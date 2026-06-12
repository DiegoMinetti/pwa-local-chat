/**
 * Orquestador de contexto: punto de entrada del pipeline por turno.
 *
 *   pregunta → routeQuery → ejecutar toolPlan (caché-first) →
 *   renderizar «Datos recuperados» → contexto dinámico mínimo.
 *
 * Decide además el modo de contexto:
 *   lean   → el documento del negocio es JSON consultable: NUNCA viaja al
 *            modelo; solo una línea de identidad + datos recuperados.
 *   legacy → documento no estructurado: se mantiene el RAG-lite existente
 *            (selectRelevantBusinessInfo) como red de seguridad.
 */

import { createTtlCache, makeCacheKey } from "./cache";
import { renderRetrievedData } from "./contextBuilder";
import { createLocalSource } from "./localSource";
import { createMetrics } from "./metrics";
import { createRemoteRegistry } from "./remoteSource";
import { routeQuery } from "./sourceRouter";
import {
  createToolRegistry,
  executeTool,
  parseToolCall,
  registerDefaultTools,
  renderToolCatalog,
} from "./toolRegistry";
import { estimateTokens } from "../memory/tokenBudget";

/**
 * Instrucciones de tools que se agregan al system prompt SOLO en modo lean.
 * Compactas: ~70 tokens + catálogo.
 */
export function buildToolSystemSuffix(toolCatalog) {
  return [
    "Los datos del negocio llegan en el bloque «Datos recuperados»; usalos como única fuente.",
    "Si te falta un dato, respondé ÚNICAMENTE con JSON {\"tool\":\"nombre\",\"args\":{...}} usando una de estas herramientas:",
    toolCatalog,
  ].join("\n");
}

export function createContextOrchestrator({
  fetchImpl = typeof fetch !== "undefined" ? fetch : null,
  cacheTtlMs,
  retrievedBudget = 600,
} = {}) {
  const cache = createTtlCache(cacheTtlMs ? { ttlMs: cacheTtlMs } : {});
  const metrics = createMetrics();

  let localSource = null;
  let remoteRegistry = createRemoteRegistry([]);
  let registry = createToolRegistry();
  let configuredBusinessInfo = null;
  let configuredRemoteKey = null;

  /**
   * (Re)construye fuentes y tools cuando cambia la configuración. Barato de
   * llamar por turno: no hace nada si los inputs no cambiaron.
   */
  function configure({ businessInfo = "", remoteSources = [] } = {}) {
    const remoteKey = JSON.stringify(remoteSources || []);
    if (businessInfo === configuredBusinessInfo && remoteKey === configuredRemoteKey) return;

    configuredBusinessInfo = businessInfo;
    configuredRemoteKey = remoteKey;

    localSource = createLocalSource(businessInfo);
    remoteRegistry = createRemoteRegistry(remoteSources, { fetchImpl });
    registry = createToolRegistry();
    registerDefaultTools(registry, { localSource, remoteRegistry });
  }

  /** Línea de identidad fija (~25 tokens) para el modo lean. */
  function buildIdentityLine() {
    if (!configuredBusinessInfo) return "";
    try {
      const data = JSON.parse(configuredBusinessInfo);
      const nombre = data?.local?.nombre || "";
      const tipo = data?.local?.tipo || "";
      if (!nombre) return "";
      return `Negocio: ${nombre}${tipo ? ` — ${tipo}` : ""}.`;
    } catch {
      return "";
    }
  }

  async function runToolPlan(toolPlan) {
    const results = [];
    for (const call of toolPlan) {
      results.push(await executeTool(registry, call, { cache, metrics }));
    }
    return results;
  }

  /**
   * Fuentes legacy (endpoints GET planos, config.dynamicSources): pasan por
   * el caché para no re-consultar la API en cada turno.
   */
  async function fetchLegacyDynamicContexts(dynamicSources = []) {
    const contexts = [];
    const errors = [];
    for (const source of dynamicSources) {
      if (!source?.endpoint || source.enabled === false) continue;
      const key = makeCacheKey("dyn", source.endpoint);
      const cached = cache.get(key);
      metrics.recordCache(cached !== undefined);
      if (cached !== undefined) {
        contexts.push(cached);
        continue;
      }
      try {
        metrics.recordApiCall(source.name);
        const response = await fetchImpl(source.endpoint, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const context = { name: source.name || "Fuente en tiempo real", content: JSON.stringify(payload) };
        cache.set(key, context);
        contexts.push(context);
      } catch (error) {
        errors.push({ name: source.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { contexts, errors };
  }

  return {
    cache,
    metrics,
    configure,
    parseToolCall,

    get toolCatalog() {
      return renderToolCatalog(registry);
    },

    /**
     * Pipeline pre-prompt para un turno.
     *
     * @returns {{
     *   leanContext: boolean, identityLine: string, retrievedText: string,
     *   route: object, dynamicContexts: Array, dynamicErrors: Array,
     *   systemSuffix: string,
     * }}
     */
    async prepareTurn(question, { businessInfo = "", remoteSources = [], dynamicSources = [] } = {}) {
      configure({ businessInfo, remoteSources });

      const leanContext = Boolean(localSource && !localSource.isEmpty);
      const route = routeQuery(question, {
        hasLocalData: leanContext,
        remoteSources: remoteRegistry.list(),
      });

      const results = route.needsData ? await runToolPlan(route.toolPlan) : [];
      const retrievedText = renderRetrievedData(results, retrievedBudget);

      const { contexts: dynamicContexts, errors: dynamicErrors } =
        await fetchLegacyDynamicContexts(dynamicSources);

      return {
        leanContext,
        identityLine: leanContext ? buildIdentityLine() : "",
        retrievedText,
        route,
        dynamicContexts,
        dynamicErrors,
        systemSuffix: leanContext ? buildToolSystemSuffix(renderToolCatalog(registry)) : "",
      };
    },

    /**
     * Segunda chance: el modelo emitió {"tool":...}. Ejecuta y devuelve el
     * texto recuperado para repreguntar, o null si no hay tool call válida.
     */
    async executeModelToolCall(modelText) {
      const call = parseToolCall(modelText);
      if (!call) return null;
      const result = await executeTool(registry, call, { cache, metrics });
      if (result.error) return null;
      const retrievedText = renderRetrievedData([result], retrievedBudget);
      return retrievedText ? { call, retrievedText } : null;
    },

    /**
     * Cierra el turno: registra tokens enviados vs. baseline (mandar el
     * documento completo + historial) y tiempo de respuesta.
     */
    finishTurn({ sentTokens = 0, fullHistoryText = "", question = "", systemPrompt = "", elapsedMs = 0 }) {
      const baseline =
        estimateTokens(systemPrompt) +
        estimateTokens(configuredBusinessInfo || "") +
        estimateTokens(fullHistoryText) +
        estimateTokens(question);
      metrics.recordTurn({ tokensSent: sentTokens, tokensBaseline: baseline });
      if (elapsedMs) metrics.recordResponseTime(elapsedMs);
      return metrics.logToConsole();
    },
  };
}
