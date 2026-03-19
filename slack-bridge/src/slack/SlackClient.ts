import { WebClient, Block, KnownBlock, View } from '@slack/web-api'
import { logger } from '../logger'

export interface SlackConfig {
  botToken: string
  appToken: string
  signingSecret: string
}

export class SlackClient {
  private client: WebClient

  constructor(config: SlackConfig) {
    this.client = new WebClient(config.botToken)
    logger.info('Slack client initialized')
  }

  // Post a message to a channel
  async postMessage(channel: string, text: string, threadTs?: string): Promise<string> {
    try {
      const result = await this.client.chat.postMessage({
        channel,
        text,
        thread_ts: threadTs,
      })

      logger.debug({ channel, ts: result.ts }, 'Message posted')
      return result.ts!
    } catch (error) {
      logger.error({ error, channel }, 'Failed to post message')
      throw error
    }
  }

  // Update an existing message
  async updateMessage(channel: string, ts: string, text: string, blocks?: (Block | KnownBlock)[]): Promise<void> {
    try {
      await this.client.chat.update({
        channel,
        ts,
        text,
        blocks,
      })

      logger.debug({ channel, ts }, 'Message updated')
    } catch (error) {
      logger.error({ error, channel, ts }, 'Failed to update message')
      throw error
    }
  }

  // Post a reply to a thread with blocks
  async postReply(channel: string, threadTs: string, blocks: (Block | KnownBlock)[]): Promise<string> {
    try {
      const result = await this.client.chat.postMessage({
        channel,
        blocks,
        thread_ts: threadTs,
      })

      logger.debug({ channel, threadTs, ts: result.ts }, 'Reply posted')
      return result.ts!
    } catch (error) {
      logger.error({ error, channel, threadTs }, 'Failed to post reply')
      throw error
    }
  }

  // Post a message with blocks (for rich formatting)
  async postMessageWithBlocks(channel: string, blocks: (Block | KnownBlock)[], threadTs?: string): Promise<string> {
    try {
      const result = await this.client.chat.postMessage({
        channel,
        blocks,
        thread_ts: threadTs,
      })

      logger.debug({ channel, ts: result.ts }, 'Message with blocks posted')
      return result.ts!
    } catch (error) {
      logger.error({ error, channel }, 'Failed to post message with blocks')
      throw error
    }
  }

  // Get user info
  async getUser(userId: string): Promise<any> {
    try {
      return await this.client.users.info({ user: userId })
    } catch (error) {
      logger.error({ error, userId }, 'Failed to get user info')
      throw error
    }
  }

  // React to a message
  async addReaction(channel: string, ts: string, emoji: string): Promise<void> {
    try {
      await this.client.reactions.add({
        channel,
        timestamp: ts,
        name: emoji,
      })
    } catch (error) {
      logger.error({ error, channel, ts, emoji }, 'Failed to add reaction')
      // Don't throw for reactions
    }
  }

  // Open a modal (for approvals)
  async openModal(triggerId: string, view: View): Promise<void> {
    try {
      await this.client.views.open({
        trigger_id: triggerId,
        view,
      })
    } catch (error) {
      logger.error({ error, triggerId }, 'Failed to open modal')
      throw error
    }
  }
}

export function createSlackClient(): SlackClient | null {
  const botToken = process.env.SLACK_BOT_TOKEN
  const appToken = process.env.SLACK_APP_TOKEN
  const signingSecret = process.env.SLACK_SIGNING_SECRET

  if (!botToken || !appToken || !signingSecret) {
    logger.warn('Slack credentials not configured')
    return null
  }

  return new SlackClient({
    botToken,
    appToken,
    signingSecret,
  })
}
