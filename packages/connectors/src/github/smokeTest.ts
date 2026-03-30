import { config } from '@dotenvx/dotenvx'
import { resolve } from 'node:path'
config({ path: resolve(__dirname, '../../../../.env') })

import { loadGitHubConfig } from '../config/githubLoader.js'
import { GitHubConnector } from './githubConnector.js'

const MAX_DOCS = 20

function docType(metadata: Record<string, unknown>): string {
  if ('number' in metadata && 'state' in metadata && 'merged' in metadata) return '[PR]   '
  if ('number' in metadata && 'state' in metadata && 'labels' in metadata) return '[ISSUE]'
  if ('extension' in metadata) return '[CODE] '
  if ('externalId' in metadata) return '[WIKI] '
  return '[README]'
}

async function main(): Promise<void> {
  console.log('Loading GitHub config...')
  const config = loadGitHubConfig()
  console.log(`Repos: ${config.repos.join(', ')}`)

  const connector = new GitHubConnector(config)
  console.log('Connecting to GitHub...')
  await connector.connect()
  console.log('Connected!\n')

  let count = 0
  for await (const doc of connector.sync()) {
    const type = docType(doc.metadata)
    const title = doc.title.slice(0, 60)
    console.log(`[${count + 1}] ${type} ${doc.sourceId} | ${title}`)
    count++
    if (count >= MAX_DOCS) break
  }

  console.log(`\nDone — ${count} documents yielded`)
  await connector.disconnect()
}

main().catch(console.error)
