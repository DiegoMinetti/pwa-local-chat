# Arquitectura de memoria jerárquica de conversación

Reemplaza el esquema anterior («resumen rolling de todo el historial en cada
prompt») por 4 capas de memoria con presupuesto de tokens fijo. El costo de
contexto **no crece con la longitud de la conversación**: a los 10 mensajes y
a los 10.000 el bloque de memoria ocupa lo mismo.

## Diagrama general

```
                         ┌────────────────────────────────────────┐
  pregunta del cliente ─▶│            MemoryManager               │
                         │  (src/memory/memoryManager.js)         │
                         └───────┬───────────────────────┬────────┘
                                 │ buildMemoryContext(q) │ recordInteraction(q, a)
                                 ▼                       ▼
        ┌──────────────────────────────────┐   ┌──────────────────────────────┐
        │        PROMPT ASSEMBLY           │   │      UPDATE PIPELINE         │
        │ 1. Working Memory   (estado)     │   │ 1. extractFacts (sin modelo) │
        │ 2. Long-Term Memory (hechos)     │   │ 2. push → Buffer (L1)        │
        │ 3. Semantic recall  (top-K)      │   │ 3. update → Working (L2)     │
        │ 4. Recent Buffer    (crudo)      │   │ 4. upsert → Long-Term (L3)   │
        │  → presupuesto repartido por     │   │ 5. remember → Semantic (L4)  │
        │    tokenBudget.js, sobrante      │   │ 6. cada 20: COMPACTACIÓN     │
        │    cae en cascada a la capa      │   │    (optimizer + prune +      │
        │    siguiente                     │   │     merge semántico)         │
        └──────────────┬───────────────────┘   │ 7. persistir                 │
                       ▼                       └──────────────────────────────┘
        chatHistory → buildMessages() (chatbot.js)
        [System] [Negocio RAG-lite] [Info actual] [MEMORIA] [Pregunta]
```

## Capas

| Capa | Módulo | Contenido | Límite | Persistencia |
|------|--------|-----------|--------|--------------|
| L1 Buffer reciente | `conversationBuffer.js` | Pares pregunta/respuesta crudos | 8 pares FIFO + budget | localStorage |
| L2 Working memory | `workingMemory.js` | Tema actual, temas activos, preguntas sin resolver | caps duros (5 temas, 2 pendientes) | localStorage |
| L3 Long-term | `longTermMemory.js` | Hechos estructurados `path → valor` con scoring | 40 hechos (críticos nunca se podan) | localStorage |
| L4 Semántica | `semanticMemory.js` | Interacciones/conocimiento con embedding, recall top-K | 400 entradas | IndexedDB (fallback RAM) |

## Decisión clave: embeddings sin modelo

`embeddings.js` usa **feature hashing** (unigramas peso 2 + trigramas de
caracteres peso 1, FNV-1a → vector 192 dims con signo, normalizado L2).

Por qué no un modelo de embeddings (MiniLM/transformers.js):

- Safari iOS mata la pestaña cerca de 1.5–2 GB (jetsam); cada MB compite con
  los pesos del LLM. Ver memoria de proyecto `pwa-chat-mobile-architecture`.
- El hashing es determinístico, instantáneo (<1 ms) y suficiente para recall
  léxico/morfológico en español (trigramas: «promoción» ≈ «promos»).
- La interfaz `{ dim, embed(text) → Float32Array }` es agnóstica: en desktop
  potente se puede inyectar un embedder con modelo vía
  `createMemoryManager({ embedder })` sin tocar nada más.

Búsqueda: scan lineal coseno sobre ≤400 entradas × 192 dims (<80k mults por
consulta — no hace falta índice ANN a esta escala).

## Scoring y supervivencia

Cada hecho/entrada lleva metadatos:

```yaml
fact:
  value: "maní"
  importance: 10      # 1-10; >= 9 = crítico, NUNCA se poda
  confidence: 0.95    # sube con repetición (dedupe refuerza, no duplica)
  lastUpdated: 1781270000000
  accessCount: 14     # sube al renderizarse/recuperarse
```

- L3: `factScore = importance + log2(1 + accessCount + count) − edadDías/30`
- L4: `retentionScore = importance + 2·log2(1 + accessCount) − edadDías/14`
- Importancias asignadas por el extractor: alergias 10, nombre/dieta 9,
  preferencias/rechazos 7, pedidos 6, ítems 5.

## Pipeline de actualización (tras CADA interacción)

```
recordInteraction({question, answer}):
  analysis = extractFacts(question, answer)      # determinístico, sin LLM
  buffer.push(pair)                              # L1, FIFO
  workingMemory.update(topics, unresolved)       # L2
  for fact in analysis.longTerm:
      longTerm.upsert(fact)                      # L3: dedupe + obsolescencia
        # mismo valor → confidence+, count+   (merge)
        # valor nuevo en path escalar → reemplaza (obsoleto fuera)
        # paths de lista → unión de valores únicos, cap 6
  if not analysis.trivial:                       # saludos no se guardan
      semantic.remember(compact(q, a))           # L4: coseno>0.92 refuerza
  if ++count % 20 == 0: compact()
  persist()
```

### Compactación periódica (`compact()`)

1. `memoryOptimizer.optimizeLongTermFacts`: normaliza valores, deduplica
   listas, borra ruido conversacional («gracias», «hola»).
2. `pruneLongTermMemory`: poda por score hasta el cap (críticos inmunes).
3. `semantic.compact()`: fusiona casi-duplicados (coseno > 0.92, suma
   accessCount, conserva mayor importancia) y poda por score hasta 400.

## Presupuesto de tokens

Total del bloque = `computeHistoryBudget(config)` (lo que sobra de la ventana
tras system prompt + negocio + contextos + respuesta reservada).

Reparto configurable (`tokenBudget.js`):

```js
DEFAULT_MEMORY_RATIOS = { working: 0.15, longTerm: 0.20, semantic: 0.30, recent: 0.35 }
```

Reglas de degradación cuando no alcanza:
1. El sobrante de cada capa cae en cascada a la siguiente (recent absorbe todo).
2. Working descarta líneas por prioridad (pendientes → temas → tema actual).
3. Long-term renderiza por importancia: lo crítico entra primero.
4. Presupuesto < 80 tokens → todo al buffer reciente (coherencia inmediata).
5. Los hechos críticos jamás se eliminan del store (solo pueden no renderizarse
   en un turno puntual).

## Ensamblado del prompt (orden fijo)

```
1. System Prompt                      (chatbot.js SYSTEM_PROMPT)
2. Información del negocio RAG-lite   (contextRetrieval.js — ya existía)
3. Información actual (fecha/hora)    (chatbot.js — ya existía)
4. BLOQUE DE MEMORIA                  (promptAssembly.js):
     Estado de la charla:          ← Working
     Datos recordados del cliente: ← Long-Term
     Recuerdos relevantes:         ← Semantic (top-3, umbral 0.3,
                                     filtrando lo ya presente en el buffer)
     Conversación reciente:        ← Buffer crudo
5. Pregunta del cliente
```

El historial completo **nunca** viaja al modelo.

## Esquemas de almacenamiento

### localStorage — `cafe-central-memory-v1`

```ts
interface PersistedMemory {
  version: 1;
  interactionCount: number;
  workingMemory: WorkingMemory;
  longTermMemory: { facts: Record<string, Fact> };
  bufferPairs: Array<{ question: string; answer: string; at: number }>;
}
```

### IndexedDB — db `pwa-chat-memory`, store `semantic_entries` (keyPath `id`)

```ts
interface SemanticEntry {
  id: string;
  kind: "interaccion" | string;
  text: string;          // compacto, sin ruido
  vector: number[];      // 192 dims, L2-normalizado
  importance: number;    // 1-10
  confidence: number;    // 0-1
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
}
```

### Interfaces principales (TypeScript)

```ts
interface Fact {
  path: string;               // "cliente.alergias"
  value?: string;             // escalar
  values?: string[];          // paths de lista
  importance: number; confidence: number;
  lastUpdated: number; accessCount: number; count: number;
}

interface WorkingMemory {
  temaActual: string | null;
  temasActivos: string[];     // máx 5
  pendientes: string[];       // máx 2
  updatedAt: number;
}

interface Embedder { dim: number; embed(text: string): Float32Array; }

interface MemoryManager {
  recordInteraction(i: { question: string; answer: string }): Promise<{ compacted: boolean }>;
  buildMemoryContext(question: string, totalBudget: number): Promise<string>;
  getDisplaySummary(maxTokens?: number): string;
  compact(): Promise<{ optimizedValues: number; prunedFacts: number; semanticRemoved: number }>;
  getStats(): { interactionCount: number; bufferPairs: number; longTermFacts: number };
  reset(): Promise<void>;
}
```

## Estructura de carpetas

```
src/memory/
├── index.js              # API pública
├── memoryManager.js      # orquestador (pipeline + assembly + persistencia)
├── conversationBuffer.js # L1
├── workingMemory.js      # L2
├── longTermMemory.js     # L3 (scoring, dedupe, prune)
├── semanticMemory.js     # L4 (recall top-K, compactación)
├── semanticStore.js      # IndexedDB + fallback en memoria
├── embeddings.js         # feature hashing + coseno
├── factExtraction.js     # extracción determinística (sin LLM)
├── memoryOptimizer.js    # normalización/dedupe/ruido
├── tokenBudget.js        # reparto configurable por capa
├── promptAssembly.js     # orden de bloques
└── memory.test.js        # 30 tests (unit + end-to-end)
```

## Recomendaciones de producción / evolución

- **Embedder con modelo**: en desktop con WebGPU sobrado, inyectar
  `@huggingface/transformers` feature-extraction (p.ej. multilingual-e5-small
  cuantizado) detrás de la misma interfaz; gatear por
  `getRecommendedSettings` para no tocar móviles.
- **Extracción con LLM**: si se amplía el dominio, correr una pasada de
  extracción con el modelo local en idle (`requestIdleCallback`) para
  enriquecer hechos; las reglas determinísticas quedan como piso (misma
  filosofía que quickLookup).
- **Backend compartido**: si algún día hay servidor, la capa semántica mapea
  1:1 a pgvector/SQLite-vec (mismo esquema de entrada); localStorage →
  tabla `kv` por usuario.
- **Versionado**: `STORAGE_VERSION` ya invalida estado incompatible; subirlo
  al cambiar el esquema de hechos.
```
