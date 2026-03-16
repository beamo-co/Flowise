import { getConfig } from '../config'
import { getLogger } from '../logger'
import { JobInput, JobStatus, jobInputSchema, JobEventType, JobEvent } from './types'
import { jobRepository, eventRepository } from '../repositories'
import { Job } from '../repositories/JobRepository'
import { getClaudeRunner, RunOptions } from '../sdk/ClaudeRunner'

// Job Manager class - now uses SQLite persistence and Claude SDK
export class JobManager {
  private logger: ReturnType<typeof getLogger>

  constructor() {
    this.logger = getLogger('JobManager')
    this.startJobProcessor()
  }

  // Create a new job
  createJob(input: JobInput): Job {
    const validated = jobInputSchema.parse(input)
    const config = getConfig()

    const job = jobRepository.create({
      role: validated.workerType || config.WORKER_ROLE,
      input: validated,
    })

    // Add initial event
    eventRepository.create(job.id, JobEventType.CREATED, { input: validated })

    this.logger.info({ jobId: job.id, prompt: job.input.prompt }, 'Job created')
    return job
  }

  // Get job by ID
  getJob(id: string): Job | null {
    return jobRepository.getById(id)
  }

  // Get all jobs
  getAllJobs(): Job[] {
    return jobRepository.getAll()
  }

  // Get jobs by status
  getJobsByStatus(status: JobStatus): Job[] {
    return jobRepository.getByStatus(status)
  }

  // Get job events
  getJobEvents(jobId: string): JobEvent[] {
    const events = eventRepository.getByJobId(jobId)
    return events.map(e => ({
      id: e.id,
      jobId: e.job_id,
      type: e.event_type as JobEventType,
      timestamp: e.created_at.toISOString(),
      data: e.payload as Record<string, unknown>,
    }))
  }

  // Get running jobs count
  getRunningCount(): number {
    return jobRepository.getByStatus(JobStatus.RUNNING).length
  }

  // Get queued jobs count
  getQueueLength(): number {
    return jobRepository.getByStatus(JobStatus.PENDING).length
  }

  // Update job status
  updateJobStatus(id: string, status: JobStatus, output?: object): Job | null {
    const updates: any = { status }

    if (status === JobStatus.RUNNING) {
      updates.started_at = new Date()
    }

    if (status === JobStatus.SUCCEEDED || status === JobStatus.FAILED) {
      updates.completed_at = new Date()
    }

    if (output) {
      updates.output = output
    }

    const job = jobRepository.update(id, updates)

    if (job) {
      eventRepository.create(id, this.statusToEventType(status), output || {})
    }

    return job
  }

  // Get next pending job
  getNextPendingJob(): Job | null {
    const config = getConfig()
    const maxConcurrency = parseInt(config.MAX_CONCURRENCY, 10)

    if (this.getRunningCount() >= maxConcurrency) {
      return null
    }

    const pendingJobs = jobRepository.getByStatus(JobStatus.PENDING)
    return pendingJobs[0] || null
  }

  private statusToEventType(status: JobStatus): JobEventType {
    switch (status) {
      case JobStatus.RUNNING:
        return JobEventType.STARTED
      case JobStatus.SUCCEEDED:
        return JobEventType.SUCCEEDED
      case JobStatus.FAILED:
        return JobEventType.FAILED
      case JobStatus.WAITING_APPROVAL:
        return JobEventType.WAITING_APPROVAL
      default:
        return JobEventType.UPDATED
    }
  }

  // Start processing jobs from queue
  private startJobProcessor(): void {
    setInterval(() => {
      this.processNextJob()
    }, 1000) // Check every second
  }

  private processNextJob(): void {
    // Get next job from queue
    const job = this.getNextPendingJob()
    if (!job) return

    // Mark as running
    this.updateJobStatus(job.id, JobStatus.RUNNING)
    this.logger.info({ jobId: job.id }, 'Job started')

    // Execute with Claude SDK (or fallback to mock)
    this.executeJob(job)
  }

  private async executeJob(job: Job): Promise<void> {
    const runner = getClaudeRunner()

    // Check if Claude is configured
    if (!runner.isConfigured()) {
      this.logger.warn({ jobId: job.id }, 'Claude API not configured, using mock execution')
      this.mockExecution(job.id)
      return
    }

    const options: RunOptions = {
      jobId: job.id,
      prompt: job.input.prompt,
      workspacePath: job.workspace_path,
      sessionId: job.session_id,
      permissionMode: 'ask',
    }

    try {
      const result = await runner.run(options)

      // Update job with result
      if (result.error) {
        this.updateJobStatus(job.id, JobStatus.FAILED, { error: result.error })
        this.logger.error({ jobId: job.id, error: result.error }, 'Job failed')
      } else {
        this.updateJobStatus(job.id, JobStatus.SUCCEEDED, {
          output: result.output,
          sessionId: result.sessionId,
        })
        this.logger.info({ jobId: job.id }, 'Job completed')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.updateJobStatus(job.id, JobStatus.FAILED, { error: errorMessage })
      this.logger.error({ jobId: job.id, error: errorMessage }, 'Job execution error')
    }
  }

  // Mock execution for testing without API key
  private mockExecution(jobId: string): void {
    setTimeout(() => {
      const job = this.getJob(jobId)
      if (job && job.status === JobStatus.RUNNING) {
        this.updateJobStatus(jobId, JobStatus.SUCCEEDED, {
          message: 'Mock job completed successfully (Claude API not configured)',
        })
        this.logger.info({ jobId }, 'Mock job completed')
      }
    }, 2000)
  }
}

// Singleton instance
let jobManager: JobManager | null = null

export function getJobManager(): JobManager {
  if (!jobManager) {
    jobManager = new JobManager()
  }
  return jobManager
}
