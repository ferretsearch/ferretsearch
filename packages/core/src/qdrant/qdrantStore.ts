import { QdrantClient } from '@qdrant/js-client-rest'
import type { Chunk, Document } from '../types.js'
import type { ChunkPayload, QdrantConfig } from './types.js'

const DEFAULTS: QdrantConfig = {
  url: 'http://localhost:6333',
  collectionName: 'ferretsearch',
  vectorSize: 768,
}

const UPSERT_BATCH_SIZE = 100

export class QdrantStore {
  private readonly client: QdrantClient
  private readonly config: QdrantConfig

  constructor(config: Partial<QdrantConfig> = {}) {
    this.config = { ...DEFAULTS, ...config }
    this.client = new QdrantClient({ url: this.config.url })
  }

  async createCollectionIfNotExists(): Promise<void> {
    const { exists } = await this.client.collectionExists(this.config.collectionName)
    if (exists) return

    await this.client.createCollection(this.config.collectionName, {
      vectors: {
        dense: { size: this.config.vectorSize, distance: 'Cosine' },
      },
      sparse_vectors: {
        sparse: {},
      },
    })
  }

  async upsertChunks(chunks: Chunk[], document: Document): Promise<void> {
    if (chunks.length === 0) return

    for (const chunk of chunks) {
      if (!chunk.embedding) {
        throw new Error(`Chunk ${chunk.id} is missing embedding — run embedder before upserting`)
      }
    }

    for (let i = 0; i < chunks.length; i += UPSERT_BATCH_SIZE) {
      const batch = chunks.slice(i, i + UPSERT_BATCH_SIZE)

      await this.client.upsert(this.config.collectionName, {
        wait: true,
        points: batch.map((chunk) => {
          const payload: ChunkPayload = {
            documentId: chunk.documentId,
            sourceType: document.sourceType,
            sourceId: document.sourceId,
            content: chunk.content,
            permissions: document.permissions,
            chunkIndex: chunk.index,
            createdAt: document.createdAt.toISOString(),
          }
          return {
            id: chunk.id,
            vector: { dense: chunk.embedding! },
            payload: payload as unknown as Record<string, unknown>,
          }
        }),
      })
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.client.delete(this.config.collectionName, {
      wait: true,
      filter: {
        must: [{ key: 'documentId', match: { value: documentId } }],
      },
    })
  }
}
