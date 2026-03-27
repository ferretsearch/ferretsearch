import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import type { SlackConfig } from '../slack/types.js'

interface YamlSlackConfig {
  botToken?: string
  channels?: string[]
  syncHistoryDays?: number
}

interface FerretSearchYaml {
  connectors?: {
    slack?: YamlSlackConfig
  }
}

function readYamlConfig(projectRoot: string): YamlSlackConfig {
  const configPath = join(projectRoot, 'ferretsearch.config.yml')
  if (!existsSync(configPath)) return {}

  const raw = readFileSync(configPath, 'utf-8')
  const parsed = loadYaml(raw) as FerretSearchYaml | null
  return parsed?.connectors?.slack ?? {}
}

export function loadSlackConfig(projectRoot?: string): SlackConfig {
  const root = projectRoot ?? process.cwd()
  const yaml = readYamlConfig(root)

  // Env vars have priority over YAML
  const botToken =
    process.env['SLACK_BOT_TOKEN'] ?? yaml.botToken

  if (!botToken) {
    throw new Error(
      'Slack connector is not configured: SLACK_BOT_TOKEN environment variable is missing. ' +
        'Set it in your environment or under connectors.slack.botToken in ferretsearch.config.yml.',
    )
  }

  const channelsEnv = process.env['SLACK_CHANNELS']
  const channels: string[] =
    channelsEnv != null && channelsEnv.trim() !== ''
      ? channelsEnv.split(',').map((c) => c.trim()).filter(Boolean)
      : (yaml.channels ?? [])

  const historyEnv = process.env['SLACK_SYNC_HISTORY_DAYS']
  const syncHistoryDays =
    historyEnv != null && historyEnv.trim() !== ''
      ? parseInt(historyEnv, 10)
      : (yaml.syncHistoryDays ?? 30)

  return {
    id: 'slack',
    type: 'slack',
    enabled: true,
    syncIntervalMinutes: 60,
    credentials: { botToken },
    botToken,
    channels,
    syncHistoryDays,
  }
}
