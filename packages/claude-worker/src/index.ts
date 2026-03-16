import express, { Express, Request, Response } from 'express'
import { loadConfig, getConfig } from './config'
import { getLogger } from './logger'
import { getDatabase } from './db/database'
import { getJobManager } from './jobs/JobManager'
import { getApprovalGateway } from './approvals'
import { JobStatus } from './jobs/types'

// Load configuration
loadConfig()
const config = getConfig()
const logger = getLogger('index')

// Initialize database
try {
  getDatabase()
  logger.info({ database: config.DATABASE_PATH }, 'Database initialized')
} catch (error) {
  logger.error({ error }, 'Failed to initialize database')
  process.exit(1)
}

const app: Express = express()

// Middleware
app.use(express.json())

// Request logging middleware
app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, 'Incoming request')
  next()
})

// Initialize Job Manager
const jobManager = getJobManager()

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    role: config.WORKER_ROLE,
    namespace: config.SESSION_NAMESPACE,
    running: jobManager.getRunningCount(),
    queued: jobManager.getQueueLength(),
  })
})

// =============================================================================
// Job API
// =============================================================================

// Create a new job
app.post('/jobs', (req: Request, res: Response) => {
  try {
    const job = jobManager.createJob(req.body)
    logger.info({ jobId: job.id }, 'Job created via API')
    res.status(201).json(job)
  } catch (error) {
    logger.error({ error }, 'Failed to create job')
    res.status(400).json({ error: 'Invalid job input' })
  }
})

// Get all jobs (optional status filter)
app.get('/jobs', (req: Request, res: Response) => {
  const status = req.query.status as JobStatus | undefined

  if (status) {
    const jobs = jobManager.getJobsByStatus(status)
    res.json({ jobs, count: jobs.length })
  } else {
    const jobs = jobManager.getAllJobs()
    res.json({ jobs, count: jobs.length })
  }
})

// Get running jobs
app.get('/jobs/running', (_req: Request, res: Response) => {
  const jobs = jobManager.getJobsByStatus(JobStatus.RUNNING)
  res.json({ jobs, count: jobs.length })
})

// Get job by ID
app.get('/jobs/:id', (req: Request, res: Response) => {
  const job = jobManager.getJob(req.params.id)

  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  res.json(job)
})

// Get job result
app.get('/jobs/:id/result', (req: Request, res: Response) => {
  const job = jobManager.getJob(req.params.id)

  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  // Only return result for terminal states
  if (job.status === JobStatus.SUCCEEDED || job.status === JobStatus.FAILED) {
    res.json({
      id: job.id,
      status: job.status,
      result: job.output,
      finishedAt: job.completed_at,
    })
  } else {
    res.json({
      id: job.id,
      status: job.status,
      message: 'Job not yet completed',
    })
  }
})

// Get job events
app.get('/jobs/:id/events', (req: Request, res: Response) => {
  const job = jobManager.getJob(req.params.id)

  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  const events = jobManager.getJobEvents(req.params.id)
  res.json({ events, count: events.length })
})

// SSE endpoint for real-time job events
app.get('/jobs/:id/events/stream', (req: Request, res: Response) => {
  const jobId = req.params.id
  const job = jobManager.getJob(jobId)

  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  // Get initial events
  const events = jobManager.getJobEvents(jobId)
  const lastSequence = events.length > 0 ? events[events.length - 1].sequence : 0

  // Send initial events
  res.write(`data: ${JSON.stringify({ type: 'connected', jobId, lastSequence })}\n\n`)

  // Send initial events
  for (const event of events) {
    res.write(`data: ${JSON.stringify({ type: 'event', ...event })}\n\n`)
  }

  // For now, we just send existing events
  // In a full implementation, this would poll for new events
  // and send them to the client

  // Handle client disconnect
  req.on('close', () => {
    res.end()
  })
})

// =============================================================================
// Approval API
// =============================================================================

const approvalGateway = getApprovalGateway()

// Get all approvals
app.get('/approvals', (_req: Request, res: Response) => {
  const approvals = approvalGateway.getAllApprovals()
  res.json({ approvals, count: approvals.length })
})

// Get pending approvals for a job
app.get('/jobs/:id/approvals', (req: Request, res: Response) => {
  const job = jobManager.getJob(req.params.id)

  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  const approvals = approvalGateway.getPendingApprovalsForJob(req.params.id)
  res.json({ approvals, count: approvals.length })
})

// Respond to an approval
app.post('/approvals/:id', (req: Request, res: Response) => {
  const { approved, response } = req.body

  if (approved === undefined) {
    res.status(400).json({ error: 'Missing approved field' })
    return
  }

  const approval = approvalGateway.respondToApproval(req.params.id, approved, response)

  if (!approval) {
    res.status(404).json({ error: 'Approval not found' })
    return
  }

  res.json(approval)
})

// =============================================================================
// Server startup
// =============================================================================

const port = parseInt(config.PORT, 10)

app.listen(port, () => {
  logger.info(
    {
      port,
      role: config.WORKER_ROLE,
      namespace: config.SESSION_NAMESPACE,
      maxConcurrency: config.MAX_CONCURRENCY,
      dataRoot: config.DATA_ROOT,
      database: config.DATABASE_PATH,
    },
    'Claude Worker started'
  )
})

export default app
