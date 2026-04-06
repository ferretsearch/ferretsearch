import type { Document } from '../types.js'

// Job payload sent to the indexing queue
export interface IndexJobData {
  document: Document
  priority?: number
  retryCount?: number
}

// Job result after processing
export interface IndexJobResult {
  documentId: string
  chunksIndexed: number
  durationMs: number
  success: boolean
  error?: string
  skipped?: boolean
}

// Payload stored in the Dead Letter Queue for permanently failed jobs
export interface DlqJobData extends IndexJobData {
  lastError?: string
  failedAt?: string
}

// Queue names
export const QUEUE_NAMES = {
  INDEXING: 'indexing',
  DEAD_LETTER: 'indexing:dlq',
} as const