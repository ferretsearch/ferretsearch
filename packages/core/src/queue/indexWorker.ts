import { Worker } from 'bullmq'
import type { Job } from 'bullmq'
import type { IndexJobData, IndexJobResult } from './types.js'
import { QUEUE_NAMES } from './types.js'
import { SlidingWindowChunker } from '../chunker/slidingWindowChunker.js'
import type { ChunkerConfig } from '../chunker/types.js'
import { OllamaEmbedder } from '../embedder/ollamaEmbedder.js'
import { QdrantStore } from '../qdrant/qdrantStore.js'
import { dlqQueue } from './indexQueue.js'
import type { Document } from '../types.js'

const connection = {
  host: process.env['REDIS_HOST'] ?? 'localhost',
  port: Number(process.env['REDIS_PORT'] ?? 6379),
}

/** Documents larger than this are skipped to avoid memory exhaustion. */
const MAX_CONTENT_BYTES = 10 * 1024 * 1024 // 10 MB

const ollamaUrl = process.env['OLLAMA_URL']
const embedder = new OllamaEmbedder(ollamaUrl ? { ollamaUrl } : {})

const qdrantUrl = process.env['QDRANT_URL']
const qdrantStore = new QdrantStore(qdrantUrl ? { url: qdrantUrl } : {})

/**
 * Returns chunker configuration adapted for each source type.
 * - Slack messages are short → lower minChunkSize to avoid dropping them.
 * - GitHub code files are denser → larger chunkSize.
 * - Drive / filesystem docs use the conservative defaults.
 */
export function getChunkerConfig(document: Document): ChunkerConfig {
  if (document.sourceType === 'slack') {
    return { chunkSize: 512, chunkOverlap: 64, minChunkSize: 5 }
  }
  if (document.sourceType === 'github') {
    return { chunkSize: 1024, chunkOverlap: 128, minChunkSize: 20 }
  }
  // default for drive and filesystem
  return { chunkSize: 512, chunkOverlap: 128, minChunkSize: 50 }
}

async function processIndexJob(
  job: Job<IndexJobData, IndexJobResult>,
): Promise<IndexJobResult> {
  const start = Date.now()
  const { document: rawDocument } = job.data

  // BullMQ serializes via JSON — dates become strings, convert back
  const document = {
    ...rawDocument,
    createdAt: new Date(rawDocument.createdAt),
    updatedAt: new Date(rawDocument.updatedAt),
  }

  // Skip empty or trivially short content without touching the pipeline
  if (!document.content || document.content.length < 3) {
    return {
      documentId: document.id,
      chunksIndexed: 0,
      durationMs: Date.now() - start,
      success: true,
    }
  }

  // Skip documents that are too large to prevent memory exhaustion.
  // Return success so BullMQ does NOT retry.
  if (Buffer.byteLength(document.content, 'utf-8') > MAX_CONTENT_BYTES) {
    console.warn(
      `[indexWorker] Skipping ${document.stableId}: content exceeds ${MAX_CONTENT_BYTES} bytes`,
    )
    return {
      documentId: document.id,
      chunksIndexed: 0,
      durationMs: Date.now() - start,
      success: true,
      skipped: true,
    }
  }

  try {
    await qdrantStore.createCollectionIfNotExists()

    // Remove stale chunks from previous indexing of this document
    await qdrantStore.deleteByStableId(document.stableId)

    // Instantiate chunker with config adapted for this source type
    const chunker = new SlidingWindowChunker(getChunkerConfig(document))
    const chunks = chunker.chunk(document.id, document.content)
    await job.updateProgress(10)

    const embeddedChunks = await embedder.embedChunks(chunks)
    await job.updateProgress(60)

    await qdrantStore.upsertChunks(embeddedChunks, document)
    await job.updateProgress(100)

    return {
      documentId: document.id,
      chunksIndexed: embeddedChunks.length,
      durationMs: Date.now() - start,
      success: true,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Job ${job.id} failed — ${message}`)
    throw error
  }
}

export const indexWorker = new Worker<IndexJobData, IndexJobResult>(
  QUEUE_NAMES.INDEXING,
  processIndexJob,
  {
    connection,
    concurrency: Number(process.env['WORKER_CONCURRENCY'] ?? 5),
  },
)

/**
 * DLQ worker — processes permanently failed jobs.
 * Currently only logs; future versions can send webhook / email alerts.
 */
export const dlqWorker = new Worker(
  QUEUE_NAMES.DEAD_LETTER,
  async (job) => {
    const data = job.data as IndexJobData & { lastError?: string }
    console.error(`[DLQ] Job ${job.id} permanently failed after ${String(job.opts.attempts)} attempts`)
    console.error(`[DLQ] Document: ${data.document?.stableId}`)
    console.error(`[DLQ] Last error: ${data.lastError ?? 'unknown'}`)
  },
  { connection },
)

// Event listeners for observability
indexWorker.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed — ${result.chunksIndexed} chunks indexed`)
})

indexWorker.on('failed', async (job, error) => {
  console.error(`Job ${job?.id} failed — ${error.message}`)
  // After 5 attempts move to DLQ for permanent logging / alerting
  if (job && job.attemptsMade >= 5) {
    await dlqQueue.add('failed', {
      ...job.data,
      lastError: error.message,
      failedAt: new Date().toISOString(),
    })
  }
})
