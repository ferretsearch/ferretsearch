import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildServer } from './server.js'
import type { ConnectorStatus, Orchestrator } from './orchestrator.js'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
const { mockEmbedText, mockSearch, mockIsPaused, mockQueueCounts, mockDlqCounts, mockDlqGetJobs } =
  vi.hoisted(() => ({
    mockEmbedText: vi.fn(),
    mockSearch: vi.fn(),
    mockIsPaused: vi.fn(),
    mockQueueCounts: {
      getWaitingCount: vi.fn().mockResolvedValue(2),
      getActiveCount: vi.fn().mockResolvedValue(1),
      getCompletedCount: vi.fn().mockResolvedValue(50),
      getFailedCount: vi.fn().mockResolvedValue(3),
    },
    mockDlqCounts: {
      getWaitingCount: vi.fn().mockResolvedValue(1),
      getJobs: vi.fn().mockResolvedValue([]),
    },
    mockDlqGetJobs: vi.fn().mockResolvedValue([]),
  }))

vi.mock('@capytrace/core', () => ({
  OllamaEmbedder: class {
    embedText = mockEmbedText
  },
  QdrantStore: class {
    search = mockSearch
  },
  indexQueue: {
    isPaused: mockIsPaused,
    getWaitingCount: mockQueueCounts.getWaitingCount,
    getActiveCount: mockQueueCounts.getActiveCount,
    getCompletedCount: mockQueueCounts.getCompletedCount,
    getFailedCount: mockQueueCounts.getFailedCount,
  },
  dlqQueue: {
    getWaitingCount: mockDlqCounts.getWaitingCount,
    getJobs: mockDlqGetJobs,
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeOrchestrator(statuses: ConnectorStatus[] = []): Orchestrator {
  return {
    getStatus: vi.fn().mockReturnValue(statuses),
    triggerSync: vi.fn().mockResolvedValue({ queued: 0, connectors: [] }),
  } as unknown as Orchestrator
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// POST /search
// ---------------------------------------------------------------------------
describe('POST /search', () => {
  it('embeds the query and returns results with took and total', async () => {
    const vector = [0.1, 0.2, 0.3]
    const result = {
      documentId: 'doc-1',
      chunkId: 'chunk-1',
      score: 0.95,
      title: 'Test',
      snippet: 'hello world',
      sourceType: 'slack',
      highlights: [],
    }
    mockEmbedText.mockResolvedValue(vector)
    mockSearch.mockResolvedValue([result])

    const app = await buildServer(makeOrchestrator())
    const response = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'hello world' },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{ results: typeof result[]; took: number; total: number }>()
    expect(body.total).toBe(1)
    expect(body.results[0]).toMatchObject({ documentId: 'doc-1', score: 0.95 })
    expect(mockEmbedText).toHaveBeenCalledWith('hello world')
    expect(mockSearch).toHaveBeenCalledWith(vector, expect.objectContaining({ limit: 10 }))
  })

  it('passes custom limit to store.search', async () => {
    mockEmbedText.mockResolvedValue([0.1])
    mockSearch.mockResolvedValue([])

    const app = await buildServer(makeOrchestrator())
    await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'test', limit: 3 },
    })

    expect(mockSearch).toHaveBeenCalledWith([0.1], expect.objectContaining({ limit: 3 }))
  })

  it('passes sourceType filter to store.search', async () => {
    mockEmbedText.mockResolvedValue([0.1])
    mockSearch.mockResolvedValue([])

    const app = await buildServer(makeOrchestrator())
    await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'test', filters: { sourceType: 'slack' } },
    })

    expect(mockSearch).toHaveBeenCalledWith(
      [0.1],
      expect.objectContaining({ filter: { sourceType: 'slack' } }),
    )
  })

  it('omits filter from store.search when none provided', async () => {
    mockEmbedText.mockResolvedValue([0.1])
    mockSearch.mockResolvedValue([])

    const app = await buildServer(makeOrchestrator())
    await app.inject({ method: 'POST', url: '/search', payload: { query: 'test' } })

    const [, opts] = mockSearch.mock.calls[0] as [unknown[], { filter?: unknown }]
    expect(opts.filter).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
describe('GET /health', () => {
  it('returns 200 ok when all services are healthy', async () => {
    mockIsPaused.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    const app = await buildServer(makeOrchestrator())
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: 'ok',
      services: { redis: true, qdrant: true, ollama: true },
    })
  })

  it('returns 503 degraded when redis is down', async () => {
    mockIsPaused.mockRejectedValue(new Error('connection refused'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    const app = await buildServer(makeOrchestrator())
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      status: 'degraded',
      services: { redis: false, qdrant: true, ollama: true },
    })
  })

  it('returns 503 degraded when qdrant is unreachable', async () => {
    mockIsPaused.mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('timeout')) // qdrant
        .mockResolvedValueOnce({ ok: true }), // ollama
    )

    const app = await buildServer(makeOrchestrator())
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      status: 'degraded',
      services: { redis: true, qdrant: false, ollama: true },
    })
  })
})

// ---------------------------------------------------------------------------
// GET /sources
// ---------------------------------------------------------------------------
describe('GET /sources', () => {
  it('returns connector statuses from the orchestrator', async () => {
    const status: ConnectorStatus = {
      id: 'slack-main',
      type: 'slack',
      status: 'idle',
      lastSync: null,
      documentsIndexed: 42,
    }

    const app = await buildServer(makeOrchestrator([status]))
    const response = await app.inject({ method: 'GET', url: '/sources' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([
      expect.objectContaining({ id: 'slack-main', documentsIndexed: 42 }),
    ])
  })

  it('returns an empty array when no connectors are active', async () => {
    const app = await buildServer(makeOrchestrator([]))
    const response = await app.inject({ method: 'GET', url: '/sources' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// POST /sync
// ---------------------------------------------------------------------------
describe('POST /sync', () => {
  it('delegates to orchestrator.triggerSync and returns the result', async () => {
    const orchestrator = makeOrchestrator()
    ;(orchestrator.triggerSync as ReturnType<typeof vi.fn>).mockResolvedValue({
      queued: 17,
      connectors: ['slack-main'],
    })

    const app = await buildServer(orchestrator)
    const response = await app.inject({ method: 'POST', url: '/sync' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ queued: 17, connectors: ['slack-main'] })
    expect(orchestrator.triggerSync).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// GET /jobs/stats
// ---------------------------------------------------------------------------
describe('GET /jobs/stats', () => {
  it('returns an object with waiting, active, completed, failed, dlq fields', async () => {
    mockQueueCounts.getWaitingCount.mockResolvedValue(2)
    mockQueueCounts.getActiveCount.mockResolvedValue(1)
    mockQueueCounts.getCompletedCount.mockResolvedValue(50)
    mockQueueCounts.getFailedCount.mockResolvedValue(3)
    mockDlqCounts.getWaitingCount.mockResolvedValue(1)

    const app = await buildServer(makeOrchestrator())
    const response = await app.inject({ method: 'GET', url: '/jobs/stats' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ waiting: 2, active: 1, completed: 50, failed: 3, dlq: 1 })
  })
})

// ---------------------------------------------------------------------------
// GET /jobs/failed
// ---------------------------------------------------------------------------
describe('GET /jobs/failed', () => {
  it('returns an array of DLQ jobs', async () => {
    mockDlqGetJobs.mockResolvedValue([
      {
        id: 'dlq-1',
        data: {
          document: { stableId: 'slack:ws:msg-1' },
          lastError: 'Ollama unavailable',
          failedAt: '2024-01-01T00:00:00.000Z',
        },
      },
    ])

    const app = await buildServer(makeOrchestrator())
    const response = await app.inject({ method: 'GET', url: '/jobs/failed' })

    expect(response.statusCode).toBe(200)
    const body = response.json<Array<{ jobId: string; stableId: string; lastError: string }>>()
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({
      jobId: 'dlq-1',
      stableId: 'slack:ws:msg-1',
      lastError: 'Ollama unavailable',
    })
  })

  it('returns an empty array when the DLQ is empty', async () => {
    mockDlqGetJobs.mockResolvedValue([])

    const app = await buildServer(makeOrchestrator())
    const response = await app.inject({ method: 'GET', url: '/jobs/failed' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })
})
