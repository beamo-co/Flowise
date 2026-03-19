import { App } from '@slack/bolt'
import http from 'http'
import { createFlowiseClient } from './flowise/FlowiseClient'
import { logger } from './logger'
import { Block, KnownBlock } from '@slack/types'

// Throttled token batcher - flushes after 1s of no new tokens
class TokenBatcher {
  private buffer = ''
  private timer: NodeJS.Timeout | null = null
  private flushFn: (content: string) => Promise<void>
  private delayMs: number
  private lastOutput = ''

  constructor(flushFn: (content: string) => Promise<void>, delayMs = 1000) {
    this.flushFn = flushFn
    this.delayMs = delayMs
  }

  add(token: string): void {
    this.buffer += token
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => this.flush(), this.delayMs)
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.buffer.trim()) {
      const content = this.buffer
      this.lastOutput = content
      this.buffer = ''
      await this.flushFn(content)
    }
  }

  getBuffer(): string {
    return this.buffer
  }

  getLastOutput(): string {
    return this.lastOutput
  }
}

// Helper to update Slack message with blocks, fallback to new message if too long
async function postOrUpdateMessage(
  client: any,
  channelId: string,
  threadTs: string,
  currentTs: string | null,
  blocks: (Block | KnownBlock)[]
): Promise<string | null> {
  if (currentTs) {
    try {
      await client.chat.update({
        channel: channelId,
        ts: currentTs,
        text: 'Processing...',
        blocks,
      })
      return currentTs
    } catch (err: any) {
      // Message too long, send new one
      logger.debug('Message too long, sending new message')
    }
  }

  // Send new message
  try {
    const result = await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Processing...',
      blocks,
    })
    return result.ts || null
  } catch (err) {
    logger.error({ err }, 'Failed to post message')
    return null
  }
}

// Build a thinking/thinking-chain block
function getThinkingBlock(reasoning: string): Block | KnownBlock {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `🧠 *Thinking*\n\`\`\`\n${escapeSlackText(reasoning)}\n\`\`\``,
    },
  }
}

// Build a token output block (code format)
function getTokenBlock(content: string): Block | KnownBlock {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `📝 *Output*\n\`\`\`\n${escapeSlackText(content)}\n\`\`\``,
    },
  }
}

// Build final answer block
function getAnswerBlock(answer: string): { text: string; blocks: (Block | KnownBlock)[] } {
  return {
    text: 'Answer',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Answer*\n\n${markdownToMrkdwn(answer)}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Session: \`completed\``,
          },
        ],
      },
    ],
  }
}

function escapeSlackText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function markdownToMrkdwn(text: string): string {
  let result = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/\*(.+?)\*/g, '_$1_')
    .replace(/`(.+?)`/g, '`$1`')
    .replace(/^- (.+)$/gm, '• $1')
    .replace(/^## (.+)$/gm, '*$1*')
    .replace(/^### (.+)$/gm, '*$1*')
  return result
}
import { v4 as uuidv4 } from 'uuid'

// Convert Slack timestamp to UUID format (e.g., "1773848287.205189" -> UUID)
function slackTsToSessionId(ts: string): string {
  // Remove dots and use as hex-like string, then pad to UUID format
  const cleanTs = ts.replace(/\D/g, '').padStart(32, '0').substring(0, 32)
  return `${cleanTs.substring(0,8)}-${cleanTs.substring(8,12)}-${cleanTs.substring(12,16)}-${cleanTs.substring(16,20)}-${cleanTs.substring(20,32)}`
}

// Initialize Flowise client
const flowiseClient = createFlowiseClient()!

// Allowed channel IDs
const allowedChannelIds = (process.env.SLACK_CHANNEL_IDS || '').split(',').filter(Boolean)

// Initialize Slack Bolt App with Socket Mode
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
})

// Health check endpoint (Express-style for Docker healthcheck)
const healthServer = http.createServer((req: any, res: any) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      service: 'slack-bridge',
      timestamp: new Date().toISOString(),
      slackConfigured: !!process.env.SLACK_BOT_TOKEN,
      flowiseConfigured: !!flowiseClient,
    }))
  } else if (req.url === '/test/predict' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk: Buffer) => body += chunk.toString())
    req.on('end', async () => {
      try {
        const { question, chatflowId, sessionId } = JSON.parse(body)
        const targetChatflowId = chatflowId || process.env.FLOWISE_CHATFLOW_ID || ''
        if (!targetChatflowId) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'chatflowId required' }))
          return
        }
        const targetSessionId = sessionId || uuidv4()

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        })

        const events = flowiseClient.streamPredictFull(targetChatflowId, {
          question,
          streaming: true,
          overrideConfig: { sessionId: targetSessionId },
        })

        for await (const event of events) {
          res.write(`data: ${JSON.stringify(event)}\n\n`)
        }
        res.end()
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
  } else {
    res.writeHead(404)
    res.end()
  }
})
healthServer.listen(3003, () => {
  logger.info({ port: 3003 }, 'Health check server started')
})

// Handle app_mention events
app.event('app_mention', async ({ event, client }) => {
  const channelId = event.channel
  const threadTs = event.thread_ts || event.ts
  const userId = event.user
  const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim()  // Remove mention

  logger.info({ channelId, threadTs, userId, text }, 'Received mention')

  // Check if channel is allowed
  if (allowedChannelIds.length > 0 && !allowedChannelIds.includes(channelId)) {
    logger.warn({ channelId }, 'Channel not allowed')
    return
  }

  if (!flowiseClient || !text) {
    return
  }

  // Convert Slack timestamp to sessionId (UUID format)
  const sessionId = threadTs ? slackTsToSessionId(threadTs) : uuidv4()
  const chatflowId = process.env.FLOWISE_CHATFLOW_ID || ''

  if (!chatflowId) {
    logger.error('FLOWISE_CHATFLOW_ID not configured')
    return
  }

  try {
    // Track message state for thinking/thinking-chain accumulation
    let currentTs: string | null = null
    let currentBlocks: (Block | KnownBlock)[] = []
    const tokenBatcher = new TokenBatcher(async (content: string) => {
      currentBlocks.push(getTokenBlock(content))
      currentTs = await postOrUpdateMessage(client, channelId, threadTs, currentTs, currentBlocks)
      if (!currentTs) currentBlocks = [currentBlocks[currentBlocks.length - 1]]
    })

    // Send initial thinking message
    const initialBlocks: (Block | KnownBlock)[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔄 *Processing...*\n\n${markdownToMrkdwn('Processing your request...')}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Session: \`${sessionId}\``,
          },
        ],
      },
    ]

    currentTs = await postOrUpdateMessage(client, channelId, threadTs, currentTs, initialBlocks)
    if (!currentTs) {
      logger.error('Failed to post initial message')
      return
    }
    currentBlocks = [...initialBlocks]

    // Stream from Flowise
    const events = flowiseClient.streamPredictFull(chatflowId, {
      question: text,
      streaming: true,
      overrideConfig: { sessionId },
    })

    for await (const sseEvent of events) {
      if (sseEvent.event === 'token') {
        // Use throttled batcher instead of immediate posting
        tokenBatcher.add(String(sseEvent.data))
      } else if (sseEvent.event === 'agentFlowEvent' && String(sseEvent.data) === 'FINISHED') {
        // Flush token batcher first
        await tokenBatcher.flush()
        // Post cached output as final answer
        const cachedOutput = tokenBatcher.getLastOutput()
        if (cachedOutput.trim()) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            ...getAnswerBlock(cachedOutput),
          })
        }
      } else if (sseEvent.event === 'agentReasoning' || sseEvent.event === 'agentFlowEvent') {
        // Flush token batcher first
        await tokenBatcher.flush()
        // Then add thinking block
        currentBlocks.push(getThinkingBlock(String(sseEvent.data)))
        currentTs = await postOrUpdateMessage(client, channelId, threadTs, currentTs, currentBlocks)
        if (!currentTs) currentBlocks = [currentBlocks[currentBlocks.length - 1]]
      } else if (sseEvent.event === 'calledTools') {
        // Skip - don't show tool calls
      } else if (sseEvent.event === 'usedTools') {
        // Skip - don't show tool output
      } else if (sseEvent.event === 'error') {
        const errorBlocks: (Block | KnownBlock)[] = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Error*\n\n${markdownToMrkdwn(String(sseEvent.data))}`,
            },
          },
        ]
        await postOrUpdateMessage(client, channelId, threadTs, currentTs, errorBlocks)
      } else if (sseEvent.event === 'metadata') {
        logger.info({ sessionId }, 'Request completed')
      }
    }

    // Flush any remaining tokens and send final answer
    await tokenBatcher.flush()
    const finalContent = tokenBatcher.getBuffer()
    if (finalContent.trim()) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        ...getAnswerBlock(finalContent),
      })
    }
  } catch (error) {
    logger.error({ error, userId, sessionId }, 'Failed to process request')
  }
})

// Handle direct messages (im)
app.message(async ({ message, client }) => {
  if (message.subtype === 'bot_message' || !('text' in message) || !('channel' in message)) {
    return
  }

  const channelId = message.channel
  const threadTs = 'thread_ts' in message ? (message as any).thread_ts : message.ts
  const userId = 'user' in message ? (message as any).user : 'unknown'
  const text = (message as any).text || ''

  logger.info({ channelId, threadTs, userId, text }, 'Received DM')

  // Check if channel is allowed
  if (allowedChannelIds.length > 0 && !allowedChannelIds.includes(channelId)) {
    logger.warn({ channelId }, 'Channel not allowed')
    return
  }

  if (!flowiseClient || !text) {
    return
  }

  const sessionId = threadTs ? slackTsToSessionId(threadTs) : uuidv4()
  const chatflowId = process.env.FLOWISE_CHATFLOW_ID || ''

  if (!chatflowId) {
    logger.error('FLOWISE_CHATFLOW_ID not configured')
    return
  }

  try {
    // Track message state for thinking/thinking-chain accumulation
    let currentTs: string | null = null
    let currentBlocks: (Block | KnownBlock)[] = []
    const tokenBatcher = new TokenBatcher(async (content: string) => {
      currentBlocks.push(getTokenBlock(content))
      currentTs = await postOrUpdateMessage(client, channelId, threadTs, currentTs, currentBlocks)
      if (!currentTs) currentBlocks = [currentBlocks[currentBlocks.length - 1]]
    })

    // Send initial thinking message
    const initialBlocks: (Block | KnownBlock)[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔄 *Processing...*\n\n${markdownToMrkdwn('Processing your request...')}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Session: \`${sessionId}\``,
          },
        ],
      },
    ]

    currentTs = await postOrUpdateMessage(client, channelId, threadTs, currentTs, initialBlocks)
    if (!currentTs) {
      logger.error('Failed to post initial message')
      return
    }
    currentBlocks = [...initialBlocks]

    const events = flowiseClient.streamPredictFull(chatflowId, {
      question: text,
      streaming: true,
      overrideConfig: { sessionId },
    })

    for await (const sseEvent of events) {
      if (sseEvent.event === 'token') {
        // Use throttled batcher instead of immediate posting
        tokenBatcher.add(String(sseEvent.data))
      } else if (sseEvent.event === 'agentFlowEvent' && String(sseEvent.data) === 'FINISHED') {
        // Flush token batcher first
        await tokenBatcher.flush()
        // Post cached output as final answer
        const cachedOutput = tokenBatcher.getLastOutput()
        if (cachedOutput.trim()) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            ...getAnswerBlock(cachedOutput),
          })
        }
      } else if (sseEvent.event === 'agentReasoning' || sseEvent.event === 'agentFlowEvent') {
        // Flush token batcher first
        await tokenBatcher.flush()
        // Then add thinking block
        currentBlocks.push(getThinkingBlock(String(sseEvent.data)))
        currentTs = await postOrUpdateMessage(client, channelId, threadTs, currentTs, currentBlocks)
        if (!currentTs) currentBlocks = [currentBlocks[currentBlocks.length - 1]]
      } else if (sseEvent.event === 'calledTools') {
        // Skip - don't show tool calls
      } else if (sseEvent.event === 'usedTools') {
        // Skip - don't show tool output
      } else if (sseEvent.event === 'error') {
        const errorBlocks: (Block | KnownBlock)[] = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Error*\n\n${markdownToMrkdwn(String(sseEvent.data))}`,
            },
          },
        ]
        await postOrUpdateMessage(client, channelId, threadTs, currentTs, errorBlocks)
      } else if (sseEvent.event === 'metadata') {
        logger.info({ sessionId }, 'Request completed')
      }
    }

    // Flush any remaining tokens and send final answer
    await tokenBatcher.flush()
    const finalContent = tokenBatcher.getBuffer()
    if (finalContent.trim()) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        ...getAnswerBlock(finalContent),
      })
    }
  } catch (error) {
    logger.error({ error, userId, sessionId }, 'Failed to process DM')
  }
})

// Start the app
;(async () => {
  await app.start(3002)
  logger.info({ port: 3002 }, 'Slack Bridge started in Socket Mode')
})()
