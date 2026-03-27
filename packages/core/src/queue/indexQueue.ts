import { Queue } from 'bullmq'
import type { IndexJobData, IndexJobResult } from './types.js'
import { QUEUE_NAMES } from './types.js'

const connection = {
  host: process.env['REDIS_HOST'] ?? 'localhost',
  port: Number(process.env['REDIS_PORT'] ?? 6379),
}

export const indexQueue = new Queue<IndexJobData, IndexJobResult>(
  QUEUE_NAMES.INDEXING,
  {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  },
)