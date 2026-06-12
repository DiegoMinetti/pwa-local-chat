/**
 * Observabilidad del pipeline de contexto.
 *
 * Acumula por sesión: tokens enviados, tokens ahorrados (vs. baseline de
 * mandar documento completo + historial completo), llamadas a tools, a APIs,
 * uso de caché y tiempos de respuesta. `logToConsole()` imprime el snapshot.
 */

export function createMetrics() {
  const state = {
    turns: 0,
    tokensSent: 0,
    tokensBaseline: 0,
    toolCalls: {}, // name → count
    apiCalls: {}, // source → count
    cacheHits: 0,
    cacheMisses: 0,
    responseTimesMs: [],
  };

  return {
    recordTurn({ tokensSent = 0, tokensBaseline = 0 } = {}) {
      state.turns += 1;
      state.tokensSent += tokensSent;
      state.tokensBaseline += Math.max(tokensBaseline, tokensSent);
    },

    recordToolCall(name) {
      state.toolCalls[name] = (state.toolCalls[name] || 0) + 1;
    },

    recordApiCall(source) {
      const key = source || "desconocida";
      state.apiCalls[key] = (state.apiCalls[key] || 0) + 1;
    },

    recordCache(hit) {
      if (hit) state.cacheHits += 1;
      else state.cacheMisses += 1;
    },

    recordResponseTime(ms) {
      state.responseTimesMs.push(ms);
    },

    snapshot() {
      const totalTimes = state.responseTimesMs.length;
      const avgMs = totalTimes
        ? Math.round(state.responseTimesMs.reduce((a, b) => a + b, 0) / totalTimes)
        : 0;
      const tokensSaved = Math.max(0, state.tokensBaseline - state.tokensSent);
      return {
        turns: state.turns,
        tokensSent: state.tokensSent,
        tokensSaved,
        savingsPercent: state.tokensBaseline
          ? Math.round((tokensSaved / state.tokensBaseline) * 100)
          : 0,
        toolCalls: { ...state.toolCalls },
        apiCalls: { ...state.apiCalls },
        cacheHits: state.cacheHits,
        cacheMisses: state.cacheMisses,
        avgResponseMs: avgMs,
      };
    },

    logToConsole() {
      const snap = this.snapshot();
      // eslint-disable-next-line no-console
      console.groupCollapsed(
        `[contexto] turno ${snap.turns} — ${snap.tokensSent} tokens enviados, ` +
          `${snap.tokensSaved} ahorrados (${snap.savingsPercent}%), respuesta media ${snap.avgResponseMs}ms`
      );
      // eslint-disable-next-line no-console
      console.table({
        "Tokens enviados": snap.tokensSent,
        "Tokens ahorrados": snap.tokensSaved,
        "Ahorro %": snap.savingsPercent,
        "Cache hits": snap.cacheHits,
        "Cache misses": snap.cacheMisses,
        "Respuesta media (ms)": snap.avgResponseMs,
      });
      if (Object.keys(snap.toolCalls).length) console.table(snap.toolCalls);
      if (Object.keys(snap.apiCalls).length) console.table(snap.apiCalls);
      // eslint-disable-next-line no-console
      console.groupEnd();
      return snap;
    },
  };
}
