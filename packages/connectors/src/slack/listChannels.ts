import '@dotenvx/dotenvx/config'

import { WebClient } from '@slack/web-api'

const client = new WebClient(process.env['SLACK_BOT_TOKEN'])

;(async () => {
  const result = await client.conversations.list({ limit: 50 })
  result.channels?.forEach((ch) => {
    console.log(`${ch.id} | #${ch.name}`)
  })
})()