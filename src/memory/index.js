/**
 * Memoria jerárquica de conversación — punto de entrada.
 *
 * Ver docs/memory-architecture.md para el diseño completo (capas, pipeline,
 * presupuestos, esquemas y decisiones).
 */

export { createMemoryManager } from "./memoryManager";
export { createHashedEmbedder, cosineSimilarity } from "./embeddings";
export { createInMemorySemanticStore, openSemanticStore } from "./semanticStore";
export { createSemanticMemory } from "./semanticMemory";
export { extractFacts } from "./factExtraction";
export { createConversationBuffer, pushInteraction, renderConversationBuffer } from "./conversationBuffer";
export { createWorkingMemory, updateWorkingMemory, renderWorkingMemory } from "./workingMemory";
export {
  createLongTermMemory,
  upsertFact,
  pruneLongTermMemory,
  renderLongTermMemory,
  factScore,
} from "./longTermMemory";
export { optimizeLongTermFacts } from "./memoryOptimizer";
export { assembleMemoryContext } from "./promptAssembly";
export { allocateMemoryBudget, DEFAULT_MEMORY_RATIOS, estimateTokens } from "./tokenBudget";
