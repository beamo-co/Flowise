import express, { Express, Request, Response } from 'express'

const app: Express = express()
const port = process.env.SLACK_BRIDGE_PORT || 3002

app.use(express.json())

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'slack-bridge', timestamp: new Date().toISOString() })
})

// Slack event endpoint (placeholder)
app.post('/slack/events', (_req: Request, res: Response) => {
  res.json({ ok: true })
})

// Flowise proxy endpoint (placeholder)
app.post('/flowise/predict', (_req: Request, res: Response) => {
  res.json({ message: 'Not implemented yet' })
})

app.listen(port, () => {
  console.log(`Slack Bridge running on port ${port}`)
})

export default app
