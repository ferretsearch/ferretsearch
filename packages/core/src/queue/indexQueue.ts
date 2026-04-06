import { Queue } from 'bullmq'
import type { IndexJobData, IndexJobResult, DlqJobData } from './types.js'
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

/** Queue for permanently failed jobs — keeps last 100 completed entries for audit. */
export const dlqQueue = new Queue<DlqJobData, IndexJobResult>(
  QUEUE_NAMES.DEAD_LETTER,
  {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: false,
    },
  },
)