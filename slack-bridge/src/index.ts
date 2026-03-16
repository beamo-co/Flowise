import express, { Express, Request, Response } from 'express'
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

// Slack event endpoint (for webhooks)
app.post('/slack/events', async (req: Request, res: Response) => {
  // Handle URL verification challenge
  if (req.body.type === 'url_verification') {
    res.json({ challenge: req.body.challenge })
    return
  }

  // Handle event callbacks
  if (req.body.type === 'event_callback') {
    const event = req.body.event as any

    logger.debug({ eventType: event?.type }, 'Received Slack event')

    // Handle message events
    if (event?.type === 'message' && event.channel_type === 'im') {
      const text = event.text as string
      const userId = event.user as string
      const channelId = event.channel as string

      logger.info({ userId, text }, 'Received DM')

      if (flowiseClient && text) {
        try {
          const response = await flowiseClient.predict(process.env.FLOWISE_CHATFLOW_ID || '', {
            question: text,
            chatId: userId,
          })

          if (slackClient) {
            await slackClient.postMessage(channelId, response.text)
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
