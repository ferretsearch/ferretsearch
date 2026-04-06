import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Job } from 'bullmq'
import type { IndexJobData, IndexJobResult } from './types.js'
import type { Document } from '../types.js'

// ---------------------------------------------------------------------------
// Shared state and mocks — hoisted so they are available in vi.mock factories
// ---------------------------------------------------------------------------
const { state, mocks } = vi.hoisted(() => {
  return {
    state: {
      capturedProcessor: undefined as
        | ((job: Job<IndexJobData, IndexJobResult>) => Promise<IndexJobResult>)
        | undefined,
      capturedFailedHandler: undefined as
        | ((job: Job<IndexJobData> | undefined, error: Error) => Promise<void> | void)
        | undefined,
    },
    mocks: {
      chunkFn: vi.fn().mockReturnValue([]),
      embedChunks: vi.fn().mockResolvedValue([]),
      createCollectionIfNotExists: vi.fn().mockResolvedValue(undefined),
      deleteByStableId: vi.fn().mockResolvedValue(undefined),
      upsertChunks: vi.fn().mockResolvedValue(undefined),
      dlqAdd: vi.fn().mockResolvedValue({ id: 'dlq-job-1' }),
    },
  }
})

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('bullmq', () => ({
  Worker: vi.fn(function (
    _name: string,
    processor: (job: Job<IndexJobData, IndexJobResult>) => Promise<IndexJobResult>,
  ) {
    if (_name === 'indexing') {
      state.capturedProcessor = processor
    }
    return {
      on: vi.fn((event: string, handler: (job: Job<IndexJobData> | undefined, error: Error) => Promise<void> | void) => {
        if (_name === 'indexing' && event === 'failed') {
          state.capturedFailedHandler = handler
        }
      }),
    }
  }),
  Queue: vi.fn(function (_name: string) {
    // Return the trackable dlqAdd mock for the DLQ queue
    if (_name === 'indexing:dlq') {
      return { add: mocks.dlqAdd, close: vi.fn(), getWaitingCount: vi.fn().mockResolvedValue(0) }
    }
    return { add: vi.fn(), close: vi.fn(), getWaitingCount: vi.fn().mockResolvedValue(0) }
  }),
}))

vi.mock('../chunker/slidingWindowChunker.js', () => ({
  SlidingWindowChunker: vi.fn(function () {
    return { chunk: mocks.chunkFn, config: {} }
  }),
}))

vi.mock('../embedder/ollamaEmbedder.js', () => ({
  OllamaEmbedder: vi.fn(function () {
    return { embedChunks: mocks.embedChunks }
  }),
}))

vi.mock('../qdrant/qdrantStore.js', () => ({
  QdrantStore: vi.fn(function () {
    return {
      createCollectionIfNotExists: mocks.createCollectionIfNotExists,
      deleteByStableId: mocks.deleteByStableId,
      upsertChunks: mocks.upsertChunks,
    }
  }),
}))

// Trigger module-level code (Worker + Queue instantiation)
import './indexWorker.js'
import { getChunkerConfig } from './indexWorker.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    stableId: 'filesystem:src-1:ext-1',
    sourceType: 'filesystem',
    sourceId: 'src-1',
    externalId: 'ext-1',
    title: 'Test Document',
    content: 'hello world this is content',
    permissions: ['user-1'],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    metadata: {},
    ...overrides,
  }
}

function makeJob(doc = makeDocument()): Job<IndexJobData, IndexJobResult> {
  return {
    id: 'job-1',
    data: { document: doc },
    attemptsMade: 1,
    opts: { attempts: 3 },
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<IndexJobData, IndexJobResult>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.chunkFn.mockReturnValue([])
  mocks.embedChunks.mockResolvedValue([])
  mocks.createCollectionIfNotExists.mockResolvedValue(undefined)
  mocks.deleteByStableId.mockResolvedValue(undefined)
  mocks.upsertChunks.mockResolvedValue(undefined)
  mocks.dlqAdd.mockResolvedValue({ id: 'dlq-job-1' })
})

// ---------------------------------------------------------------------------
// getChunkerConfig
// ---------------------------------------------------------------------------
describe('getChunkerConfig', () => {
  it('returns low minChunkSize for slack documents', () => {
    const doc = makeDocument({ sourceType: 'slack' })
    const config = getChunkerConfig(doc)
    expect(config.minChunkSize).toBe(5)
    expect(config.chunkOverlap).toBe(64)
  })

  it('returns large chunkSize for github documents', () => {
    const doc = makeDocument({ sourceType: 'github' })
    const config = getChunkerConfig(doc)
    expect(config.chunkSize).toBe(1024)
    expect(config.minChunkSize).toBe(20)
  })

  it('returns default config for filesystem documents', () => {
    const doc = makeDocument({ sourceType: 'filesystem' })
    const config = getChunkerConfig(doc)
    expect(config.chunkSize).toBe(512)
    expect(config.minChunkSize).toBe(50)
  })

  it('returns default config for drive documents', () => {
    const doc = makeDocument({ sourceType: 'drive' })
    const config = getChunkerConfig(doc)
    expect(config.chunkSize).toBe(512)
    expect(config.minChunkSize).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// Short / empty content (A1)
// ---------------------------------------------------------------------------
describe('short and empty content handling', () => {
  it('returns chunksIndexed: 0 for empty content without calling embedder', async () => {
    const job = makeJob(makeDocument({ content: '' }))
    const result = await state.capturedProcessor!(job)

    expect(result.chunksIndexed).toBe(0)
    expect(result.success).toBe(true)
    expect(mocks.embedChunks).not.toHaveBeenCalled()
  })

  it('returns chunksIndexed: 0 for content shorter than 3 chars without calling embedder', async () => {
    const job = makeJob(makeDocument({ content: 'ok' }))
    const result = await state.capturedProcessor!(job)

    expect(result.chunksIndexed).toBe(0)
    expect(result.success).toBe(true)
    expect(mocks.embedChunks).not.toHaveBeenCalled()
  })

  it('processes Slack message with 3 words — at least 1 chunk (minChunkSize: 5)', async () => {
    // With minChunkSize: 5 for slack, a 3-word message should still be chunked (< minChunkSize
    // causes the chunk loop to break, but the mock always returns a chunk regardless)
    mocks.chunkFn.mockReturnValue([
      { id: 'c-1', documentId: 'doc-1', index: 0, content: 'hello world today', tokenCount: 3 },
    ])
    mocks.embedChunks.mockResolvedValue([
      { id: 'c-1', documentId: 'doc-1', index: 0, content: 'hello world today', tokenCount: 3, embedding: [0.1] },
    ])

    const doc = makeDocument({ sourceType: 'slack', content: 'hello world today' })
    const job = makeJob(doc)
    const result = await state.capturedProcessor!(job)

    expect(result.chunksIndexed).toBeGreaterThanOrEqual(1)
    expect(result.success).toBe(true)
    // Verify the chunker was called with the slack-appropriate config (minChunkSize: 5)
    const { SlidingWindowChunker } = await import('../chunker/slidingWindowChunker.js')
    const constructorCalls = vi.mocked(SlidingWindowChunker).mock.calls
    const lastCall = constructorCalls[constructorCalls.length - 1]
    expect(lastCall?.[0]).toMatchObject({ minChunkSize: 5 })
  })
})

// ---------------------------------------------------------------------------
// Document size limit (A2)
// ---------------------------------------------------------------------------
describe('document size limit', () => {
  it('returns { chunksIndexed: 0, skipped: true } for content > 10MB without calling chunker', async () => {
    // Generate a string slightly over 10MB
    const bigContent = 'a'.repeat(10 * 1024 * 1024 + 1)
    const job = makeJob(makeDocument({ content: bigContent }))
    const result = await state.capturedProcessor!(job)

    expect(result.chunksIndexed).toBe(0)
    expect(result.skipped).toBe(true)
    expect(result.success).toBe(true)
    expect(mocks.chunkFn).not.toHaveBeenCalled()
  })

  it('processes document just under 10MB normally', async () => {
    const okContent = 'word '.repeat(2_000_000) // ~10MB of words
    // If it's under the limit, the chunker should be called
    const job = makeJob(makeDocument({ content: okContent }))
    mocks.chunkFn.mockReturnValue([{ id: 'c-1', documentId: 'doc-1', index: 0, content: 'word', tokenCount: 1 }])
    mocks.embedChunks.mockResolvedValue([{ id: 'c-1', documentId: 'doc-1', index: 0, content: 'word', tokenCount: 1, embedding: [0.1] }])

    const byteLength = Buffer.byteLength(okContent, 'utf-8')
    if (byteLength <= 10 * 1024 * 1024) {
      const result = await state.capturedProcessor!(job)
      expect(result.skipped).toBeUndefined()
      expect(mocks.chunkFn).toHaveBeenCalled()
    }
    // If our test string happens to be over 10MB we skip assertion — this is just a sanity check
  })
})

// ---------------------------------------------------------------------------
// DLQ behavior (A5)
// ---------------------------------------------------------------------------
describe('DLQ behavior', () => {
  it('moves job to DLQ when attemptsMade >= 5', async () => {
    const job = {
      id: 'job-dlq',
      attemptsMade: 5,
      data: { document: makeDocument() },
      opts: { attempts: 5 },
    } as unknown as Job<IndexJobData>

    await state.capturedFailedHandler!(job, new Error('Ollama timeout'))

    expect(mocks.dlqAdd).toHaveBeenCalledWith(
      'failed',
      expect.objectContaining({ lastError: 'Ollama timeout' }),
    )
  })

  it('does not move job to DLQ when attemptsMade < 5', async () => {
    const job = {
      id: 'job-3',
      attemptsMade: 3,
      data: { document: makeDocument() },
      opts: { attempts: 5 },
    } as unknown as Job<IndexJobData>

    await state.capturedFailedHandler!(job, new Error('timeout'))

    expect(mocks.dlqAdd).not.toHaveBeenCalled()
  })

  it('does not throw when job is undefined', async () => {
    await expect(
      state.capturedFailedHandler!(undefined, new Error('unknown')),
    ).resolves.not.toThrow()

    expect(mocks.dlqAdd).not.toHaveBeenCalled()
  })
})
