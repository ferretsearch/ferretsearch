import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import fastifyStatic from '@fastify/static'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { OllamaEmbedder, QdrantStore, indexQueue, dlqQueue } from '@capytrace/core'
import type { SearchResult, DlqJobData } from '@capytrace/core'
import type { Orchestrator } from './orchestrator.js'

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

type SearchFilters = {
  sourceType?: string
  author?: string
}

type SearchBody = {
  query: string
  limit?: number
  sources?: string[]
  filters?: SearchFilters
}

type SearchResponse = {
  results: SearchResult[]
  took: number
  total: number
}

type HealthResponse = {
  status: 'ok' | 'degraded'
  services: { redis: boolean; qdrant: boolean; ollama: boolean }
}

// ---------------------------------------------------------------------------
// Health helpers
// ---------------------------------------------------------------------------

async function checkRedis(): Promise<boolean> {
  try {
    await indexQueue.isPaused()
    return true
  } catch {
    return false
  }
}

async function checkQdrant(url: string): Promise<boolean> {
  try {
    const resp = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(3000) })
    return resp.ok
  } catch {
    return false
  }
}

async function checkOllama(url: string): Promise<boolean> {
  try {
    const resp = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) })
    return resp.ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export async function buildServer(orchestrator: Orchestrator) {
  const app = Fastify({ logger: false })

  await app.register(cors)
  await app.register(helmet, { contentSecurityPolicy: false })

  const qdrantUrl = process.env['QDRANT_URL'] ?? 'http://localhost:6333'
  const ollamaUrl = process.env['OLLAMA_URL'] ?? 'http://localhost:11434'

  const embedder = new OllamaEmbedder({ ollamaUrl })
  const store = new QdrantStore({ url: qdrantUrl })

  // ── POST /search ──────────────────────────────────────────────────────────
  app.post<{ Body: SearchBody; Reply: SearchResponse }>(
    '/search',
    async (request, reply) => {
      const start = Date.now()
      const { query, limit = 10, filters } = request.body

      const vector = await embedder.embedText(query)

      const searchFilter: { sourceType?: string; author?: string } = {}
      if (filters?.sourceType !== undefined) searchFilter.sourceType = filters.sourceType
      if (filters?.author !== undefined) searchFilter.author = filters.author
      const hasFilter = Object.keys(searchFilter).length > 0

      const searchOptions: { limit: number; filter?: { sourceType?: string; author?: string } } = { limit }
      if (hasFilter) searchOptions.filter = searchFilter

      const results = await store.search(vector, searchOptions)

      // Deduplicate: keep only the highest-scoring chunk per document
      const seen = new Map<string, SearchResult>()
      for (const result of results) {
        const existing = seen.get(result.documentId)
        if (existing === undefined || result.score > existing.score) {
          seen.set(result.documentId, result)
        }
      }
      const deduplicated = Array.from(seen.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)

      return reply.send({ results: deduplicated, took: Date.now() - start, total: deduplicated.length })
    },
  )

  // ── GET /health ───────────────────────────────────────────────────────────
  app.get<{ Reply: HealthResponse }>('/health', async (_request, reply) => {
    const [redis, qdrant, ollama] = await Promise.all([
      checkRedis(),
      checkQdrant(qdrantUrl),
      checkOllama(ollamaUrl),
    ])

    const allOk = redis && qdrant && ollama
    return reply
      .code(allOk ? 200 : 503)
      .send({ status: allOk ? 'ok' : 'degraded', services: { redis, qdrant, ollama } })
  })

  // ── GET /sources ──────────────────────────────────────────────────────────
  app.get('/sources', async (_request, reply) => {
    return reply.send(orchestrator.getStatus())
  })

  // ── POST /sync ────────────────────────────────────────────────────────────
  app.post('/sync', async (_request, reply) => {
    const result = await orchestrator.triggerSync()
    return reply.send(result)
  })

  // ── GET /jobs/progress (SSE) ──────────────────────────────────────────────
  // Streams live queue counts as Server-Sent Events every 2 seconds.
  // The client closes the connection when it no longer needs updates.
  app.get('/jobs/progress', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const sendCounts = async () => {
      const [waiting, active, completed, failed] = await Promise.all([
        indexQueue.getWaitingCount(),
        indexQueue.getActiveCount(),
        indexQueue.getCompletedCount(),
        indexQueue.getFailedCount(),
      ])
      reply.raw.write(`data: ${JSON.stringify({ waiting, active, completed, failed })}\n\n`)
    }

    await sendCounts()
    const interval = setInterval(() => { void sendCounts() }, 2000)
    request.raw.on('close', () => clearInterval(interval))
  })

  // ── GET /jobs/stats ───────────────────────────────────────────────────────
  // Snapshot of current queue counts (non-SSE version for polling / dashboards).
  app.get('/jobs/stats', async (_request, reply) => {
    const [waiting, active, completed, failed, dlq] = await Promise.all([
      indexQueue.getWaitingCount(),
      indexQueue.getActiveCount(),
      indexQueue.getCompletedCount(),
      indexQueue.getFailedCount(),
      dlqQueue.getWaitingCount(),
    ])
    return reply.send({ waiting, active, completed, failed, dlq })
  })

  // ── GET /jobs/failed ──────────────────────────────────────────────────────
  // Returns the last 20 jobs in the Dead Letter Queue.
  app.get('/jobs/failed', async (_request, reply) => {
    const jobs = await dlqQueue.getJobs(['waiting', 'completed'], 0, 19)
    const result = jobs.slice(0, 20).map((job) => {
      const data = job.data as DlqJobData
      return {
        jobId: job.id,
        stableId: data.document?.stableId,
        lastError: data.lastError,
        failedAt: data.failedAt,
      }
    })
    return reply.send(result)
  })

  // ── UI static assets (production only) ────────────────────────────────────
  const uiDist = join(__dirname, '..', '..', 'ui', 'dist')
  const uiIndex = join(uiDist, 'index.html')

  if (existsSync(uiIndex)) {
    const assetsDir = join(uiDist, 'assets')
    if (existsSync(assetsDir)) {
      await app.register(fastifyStatic, {
        root: assetsDir,
        prefix: '/assets/',
      })
    }

    const indexHtml = readFileSync(uiIndex, 'utf-8')
    app.get('/', async (_request, reply) => {
      return reply.type('text/html').send(indexHtml)
    })
  }

  return app
}
