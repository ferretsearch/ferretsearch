import type { Chunk } from '../types.js'

export interface EmbedderConfig {
  ollamaUrl: string
  model: string
  batchSize: number
  timeoutMs: number
  retryDelayMs: number
}

export interface IEmbedder {
  embedChunks(chunks: Chunk[]): Promise<Chunk[]>
}
