import { WebClient } from '@slack/web-api'
import type { ConversationsHistoryArguments } from '@slack/web-api'
import type { SlackChannel, SlackFile, SlackMessage } from './types.js'

const RATE_LIMIT_DELAY_MS = 1200

export class SlackClient {
  private client: WebClient

  constructor(botToken: string) {
    this.client = new WebClient(botToken)
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.client.auth.test()
      return result.ok === true
    } catch {
      return false
    }
  }

  async getChannels(channelIds: string[]): Promise<SlackChannel[]> {
    const channels: SlackChannel[] = []

    for (const id of channelIds) {
      const result = await this.client.conversations.info({ channel: id })
      if (result.ok && result.channel) {
        const ch = result.channel as {
          id?: string
          name?: string
          is_private?: boolean
          num_members?: number
        }
        const channel: SlackChannel = {
          id: ch.id ?? id,
          name: ch.name ?? id,
          is_private: ch.is_private ?? false,
        }
        if (ch.num_members !== undefined) {
          channel.num_members = ch.num_members
        }
        channels.push(channel)
      }
    }

    return channels
  }

  async *getMessages(
    channelId: string,
    oldestTs?: string,
  ): AsyncGenerator<SlackMessage[]> {
    let cursor: string | undefined
    let isFirst = true

    do {
      if (!isFirst) {
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS))
      }
      isFirst = false

      const args: ConversationsHistoryArguments = { channel: channelId, limit: 200 }
      if (oldestTs !== undefined) args.oldest = oldestTs
      if (cursor !== undefined) args.cursor = cursor

      const result = await this.client.conversations.history(args)

      if (!result.ok || !result.messages || result.messages.length === 0) break

      const messages: SlackMessage[] = result.messages.map((m) => {
        const msg = m as {
          ts?: string
          text?: string
          user?: string
          thread_ts?: string
          files?: Array<{
            id?: string
            name?: string
            filetype?: string
            url_private_download?: string
            size?: number
            mimetype?: string
          }>
          reactions?: Array<{ name?: string; count?: number; users?: string[] }>
          type?: string
        }

        const message: SlackMessage = {
          ts: msg.ts ?? '',
          text: msg.text ?? '',
          type: msg.type ?? 'message',
        }
        if (msg.user !== undefined) message.user = msg.user
        if (msg.thread_ts !== undefined) message.thread_ts = msg.thread_ts
        if (msg.files !== undefined && msg.files.length > 0) {
          const validFiles = msg.files.filter(
            (f): f is typeof f & { id: string; name: string; url_private_download: string } =>
              typeof f.id === 'string' &&
              typeof f.name === 'string' &&
              typeof f.url_private_download === 'string',
          )
          if (validFiles.length > 0) {
            message.files = validFiles.map(
              (f): SlackFile => ({
                id: f.id,
                name: f.name,
                filetype: f.filetype ?? '',
                url_private_download: f.url_private_download,
                size: f.size ?? 0,
                mimetype: f.mimetype ?? '',
              }),
            )
          }
        }
        if (msg.reactions !== undefined) {
          message.reactions = msg.reactions.map((r) => ({
            name: r.name ?? '',
            count: r.count ?? 0,
            users: r.users ?? [],
          }))
        }
        return message
      })

      yield messages

      cursor =
        result.response_metadata?.next_cursor &&
        result.response_metadata.next_cursor !== ''
          ? result.response_metadata.next_cursor
          : undefined
    } while (cursor !== undefined)
  }
}
