import { config } from '@dotenvx/dotenvx'
import { resolve } from 'node:path'
config({ path: resolve(__dirname, '../../../../.env') })

import { loadSlackConfig } from '../config/loader.js'
import { SlackConnector } from './slackConnector.js'

async function main(): Promise<void> {
  console.log('Loading config...')
  const slackConfig = loadSlackConfig()

  console.log('Connecting to Slack...')
  const connector = new SlackConnector(slackConfig)
  await connector.connect()
  console.log('Connected successfully!')

  console.log('Syncing documents...')
  let count = 0
  for await (const doc of connector.sync()) {
    const isFile = doc.metadata['fileType'] !== undefined
    const prefix = isFile ? '[FILE]' : '[MSG] '
    console.log(`[${count + 1}] ${prefix} ${doc.sourceType} | ${doc.title.slice(0, 60)}`)
    if (isFile) {
      console.log(`       url: ${String(doc.url ?? '').slice(0, 80)}`)
    }
    count++
    if (count >= 20) break
  }

  console.log(`Done — ${count} documents synced`)
  await connector.disconnect()
}

main().catch(console.error)