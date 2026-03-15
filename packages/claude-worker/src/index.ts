import express, { Express, Request, Response } from 'express'
import { loadConfig, getConfig } from './config'
import { getLogger } from './logger'
import { JobManager } from './jobs/JobManager'
import { JobStatus } from './jobs/types'

// Load configuration
loadConfig()
const config = getConfig()
const logger = getLogger('index')

const app: Express = express()

// Middleware
app.use(express.json())

// Request logging middleware
app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, 'Incoming request')
  next()
})

// Initialize Job Manager
const jobManager = new JobManager()

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
      result: job.result,
      error: job.error,
      finishedAt: job.finishedAt,
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
    },
    'Claude Worker started'
  )
})

export default app
