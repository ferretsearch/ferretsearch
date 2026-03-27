import { describe, it, expect, vi, afterEach } from 'vitest'
import { OllamaEmbedder } from './ollamaEmbedder.js'
import type { Chunk } from '../types.js'

function makeChunk(documentId: string, content: string, index = 0): Chunk {
  return { id: `chunk-${index}`, documentId, index, content, tokenCount: content.split(' ').length }
}

function mockFetchOnce(embeddings: number[][]): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ embeddings }),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OllamaEmbedder', () => {
  it('fills the embedding field on each returned chunk', async () => {
    vi.stubGlobal('fetch', mockFetchOnce([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]))

    const embedder = new OllamaEmbedder()
    const result = await embedder.embedChunks([
      makeChunk('doc-1', 'hello world', 0),
      makeChunk('doc-1', 'foo bar', 1),
    ])

    expect(result[0]!.embedding).toEqual([0.1, 0.2, 0.3])
    expect(result[1]!.embedding).toEqual([0.4, 0.5, 0.6])
  })

  it('does not mutate the original chunk objects', async () => {
    vi.stubGlobal('fetch', mockFetchOnce([[0.1, 0.2]]))

    const original = makeChunk('doc-1', 'hello', 0)
    const result = await new OllamaEmbedder().embedChunks([original])

    expect(original.embedding).toBeUndefined()
    expect(result[0]!.embedding).toEqual([0.1, 0.2])
  })

  it('returns empty array without calling fetch when input is empty', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const result = await new OllamaEmbedder().embedChunks([])

    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('splits chunks into batches respecting batchSize', async () => {
    const mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { input: string[] }
      const embeddings = body.input.map((_, i) => [i * 0.1])
      return Promise.resolve({ ok: true, json: async () => ({ embeddings }) })
    })
    vi.stubGlobal('fetch', mockFetch)

    const chunks = Array.from({ length: 5 }, (_, i) => makeChunk('doc-1', `word${i}`, i))
    const result = await new OllamaEmbedder({ batchSize: 2 }).embedChunks(chunks)

    expect(mockFetch).toHaveBeenCalledTimes(3) // ceil(5/2) = 3
    expect(result).toHaveLength(5)
  })

  it('retries when the API fails on the first attempt and succeeds on the second', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ embeddings: [[0.1, 0.2]] }) })
    vi.stubGlobal('fetch', mockFetch)

    const result = await new OllamaEmbedder({ retryDelayMs: 0 }).embedChunks([makeChunk('doc-1', 'hello', 0)])

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result[0]!.embedding).toEqual([0.1, 0.2])
  })

  it('throws after exhausting all retry attempts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Persistent failure')))

    await expect(
      new OllamaEmbedder({ retryDelayMs: 0 }).embedChunks([makeChunk('doc-1', 'hello', 0)]),
    ).rejects.toThrow('Persistent failure')
  })
})
