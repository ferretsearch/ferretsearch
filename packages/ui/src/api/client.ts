export interface SearchResult {
  documentId: string
  chunkId: string
  score: number
  title: string
  snippet: string
  url?: string
  sourceType: 'slack' | 'teams' | 'github' | 'drive' | 'filesystem'
  highlights: string[]
}

export interface SearchOptions {
  limit?: number
  filters?: { sourceType?: string }
}

export interface SearchResponse {
  results: SearchResult[]
  took: number
  total: number
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  services: { redis: boolean; qdrant: boolean; ollama: boolean }
}

export interface SourcesResponse {
  connectors: { name: string; status: string; lastSync: string; documentsIndexed: number }[]
}

export interface SyncResponse {
  queued: number
  connectors: string[]
}

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const signal = AbortSignal.timeout(30_000)
  const response = await fetch(url, { ...options, signal })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  return response
}

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  const response = await fetchWithTimeout('/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: options.limit, filters: options.filters }),
  })
  return response.json() as Promise<SearchResponse>
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetchWithTimeout('/health')
  return response.json() as Promise<HealthResponse>
}

export async function getSources(): Promise<SourcesResponse> {
  const response = await fetchWithTimeout('/sources')
  return response.json() as Promise<SourcesResponse>
}

export async function triggerSync(): Promise<SyncResponse> {
  const response = await fetchWithTimeout('/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  return response.json() as Promise<SyncResponse>
}
