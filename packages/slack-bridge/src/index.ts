import express, { Express, Request, Response } from 'express'
import { App, SlackEvent, SlackShortcut, SlackViewAction } from '@slack/bolt'
import { createSlackClient } from './slack/SlackClient'
import { createFlowiseClient } from './flowise/FlowiseClient'
import { logger } from './logger'

const app: Express = express()
const port = process.env.SLACK_BRIDGE_PORT || 3002

app.use(express.json())

// Initialize clients
const slackClient = createSlackClient()
const flowiseClient = createFlowiseClient()

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'slack-bridge',
    timestamp: new Date().toISOString(),
    slackConfigured: !!slackClient,
    flowiseConfigured: !!flowiseClient,
  })
})

// Initialize Slack Bolt app if credentials are available
let boltApp: App | null = null

if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET) {
  boltApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: !!process.env.SLACK_APP_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
  })

  // Handle app_mention events
  boltApp.event('app_mention', async ({ event, client }) => {
    logger.info({ event }, 'App mentioned')

    const channelId = event.channel
    const userId = event.user
    const text = event.text

    // Send typing indicator
    await client.chat.postTyping({ channel: channelId })

    // Get user info
    const userInfo = await client.users.info({ user: userId })

    // Forward to Flowise
    if (flowiseClient) {
      try {
        // Extract question from mention (remove the bot user ID)
        const question = text.replace(/<@[A-Z0-9]+>/g, '').trim()

        const response = await flowiseClient.predict(process.env.FLOWISE_CHATFLOW_ID || '', {
          question,
          chatId: `${channelId}-${event.ts}`,
        })

        // Send response back to channel
        await client.chat.postMessage({
          channel: channelId,
          text: response.text,
          thread_ts: event.ts,
        })
      } catch (error) {
        logger.error({ error }, 'Failed to get Flowise prediction')

        await client.chat.postMessage({
          channel: channelId,
          text: 'Sorry, I encountered an error processing your request.',
          thread_ts: event.ts,
        })
      }
    } else {
      await client.chat.postMessage({
        channel: channelId,
        text: 'Flowise is not configured. Please set FLOWISE_URL environment variable.',
        thread_ts: event.ts,
      })
    }
  })

  // Handle shortcut callbacks
  boltApp.shortcut('approve_action', async ({ shortcut, ack, client }) => {
    await ack()

    logger.info({ shortcut }, 'Approval shortcut triggered')

    // Handle approval action
    const { action_id, value } = shortcut.message

    // Respond to the approval
    // This would call the worker API
    await client.chat.postMessage({
      channel: shortcut.user.id,
      text: `Action approved: ${value}`,
    })
  })

  // Start the Bolt app
  ;(async () => {
    try {
      await boltApp!.start(port)
      logger.info({ port }, 'Slack Bolt app started')
    } catch (error) {
      logger.error({ error }, 'Failed to start Slack Bolt app')
    }
  })()
} else {
  logger.warn('Slack credentials not configured, Slack events will not be handled')
}

// Slack event endpoint (for webhooks)
app.post('/slack/events', async (req: Request, res: Response) => {
  // Handle URL verification challenge
  if (req.body.type === 'url_verification') {
    res.json({ challenge: req.body.challenge })
    return
  }

  // Handle event callbacks
  if (req.body.type === 'event_callback') {
    const event = req.body.event as SlackEvent

    logger.debug({ eventType: event.type }, 'Received Slack event')

    // Handle message events
    if (event.type === 'message' && event.channel_type === 'im') {
      // Direct message to the bot
      const text = event.text
      const userId = event.user

      logger.info({ userId, text }, 'Received DM')

      if (flowiseClient && text) {
        try {
          const response = await flowiseClient.predict(process.env.FLOWISE_CHATFLOW_ID || '', {
            question: text,
            chatId: userId,
          })

          if (slackClient) {
            await slackClient.postMessage(event.channel, response.text)
          }
        } catch (error) {
          logger.error({ error }, 'Failed to get prediction')
        }
      }
    }
  }

  res.json({ ok: true })
})

// Flowise proxy endpoint
app.post('/flowise/predict', async (req: Request, res: Response) => {
  if (!flowiseClient) {
    res.status(500).json({ error: 'Flowise not configured' })
    return
  }

  const { chatflowId, question, chatId } = req.body

  if (!chatflowId || !question) {
    res.status(400).json({ error: 'chatflowId and question are required' })
    return
  }

  try {
    const response = await flowiseClient.predict(chatflowId, {
      question,
      chatId,
    })
    res.json(response)
  } catch (error) {
    logger.error({ error }, 'Failed to get prediction')
    res.status(500).json({ error: 'Prediction failed' })
  }
})

// Approval endpoint (called from Slack)
app.post('/approvals/:approvalId', async (req: Request, res: Response) => {
  const { approvalId } = req.params
  const { approved, response } = req.body

  const workerUrl = process.env.CLAUDE_WORKER_URL || 'http://localhost:3001'

  try {
    const result = await fetch(`${workerUrl}/approvals/${approvalId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, response }),
    })

    const data = await result.json()
    res.json(data)
  } catch (error) {
    logger.error({ error, approvalId }, 'Failed to respond to approval')
    res.status(500).json({ error: 'Failed to respond to approval' })
  }
})

// Start server
app.listen(port, () => {
  logger.info({ port }, 'Slack Bridge started')
})

export default app
