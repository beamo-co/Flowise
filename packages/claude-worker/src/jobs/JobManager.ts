import { v4 as uuidv4 } from 'uuid'
import { getConfig } from '../config'
import { getLogger } from '../logger'
import { JobInput, JobOutput, JobStatus, jobInputSchema, JobEventType, JobEvent } from './types'

// In-memory job storage (will be replaced with SQLite in Phase 2)
class InMemoryJobStore {
  private jobs: Map<string, JobOutput> = new Map()
  private events: Map<string, JobEvent[]> = new Map()
  private queue: string[] = []
  private running: Set<string> = new Set()

  createJob(input: JobInput): JobOutput {
    const now = new Date().toISOString()
    const job: JobOutput = {
      id: uuidv4(),
      status: JobStatus.PENDING,
      prompt: input.prompt,
      createdAt: now,
      updatedAt: now,
    }
    this.jobs.set(job.id, job)
    this.queue.push(job.id)
    this.addEvent(job.id, JobEventType.CREATED, { input })
    return job
  }

  getJob(id: string): JobOutput | undefined {
    return this.jobs.get(id)
  }

  getAllJobs(): JobOutput[] {
    return Array.from(this.jobs.values())
  }

  getJobsByStatus(status: JobStatus): JobOutput[] {
    return Array.from(this.jobs.values()).filter((job) => job.status === status)
  }

  updateJob(id: string, updates: Partial<JobOutput>): JobOutput | undefined {
    const job = this.jobs.get(id)
    if (!job) return undefined
    const updated = { ...job, ...updates, updatedAt: new Date().toISOString() }
    this.jobs.set(id, updated)
    return updated
  }

  getNextQueuedJob(): JobOutput | undefined {
    const config = getConfig()
    const maxConcurrency = parseInt(config.MAX_CONCURRENCY, 10)

    if (this.running.size >= maxConcurrency) {
      return undefined
    }

    while (this.queue.length > 0) {
      const jobId = this.queue.shift()!
      const job = this.jobs.get(jobId)
      if (job && job.status === JobStatus.PENDING) {
        return job
      }
    }
    return undefined
  }

  startJob(id: string): JobOutput | undefined {
    const job = this.updateJob(id, {
      status: JobStatus.RUNNING,
      startedAt: new Date().toISOString(),
    })
    if (job) {
      this.running.add(id)
      this.addEvent(id, JobEventType.STARTED, {})
    }
    return job
  }

  completeJob(id: string, result: unknown): JobOutput | undefined {
    const job = this.updateJob(id, {
      status: JobStatus.SUCCEEDED,
      result,
      finishedAt: new Date().toISOString(),
    })
    if (job) {
      this.running.delete(id)
      this.addEvent(id, JobEventType.SUCCEEDED, { result })
    }
    return job
  }

  failJob(id: string, error: string): JobOutput | undefined {
    const job = this.updateJob(id, {
      status: JobStatus.FAILED,
      error,
      finishedAt: new Date().toISOString(),
    })
    if (job) {
      this.running.delete(id)
      this.addEvent(id, JobEventType.FAILED, { error })
    }
    return job
  }

  getEvents(jobId: string): JobEvent[] {
    return this.events.get(jobId) || []
  }

  addEvent(jobId: string, type: JobEventType, data?: Record<string, unknown>): void {
    const events = this.events.get(jobId) || []
    const event: JobEvent = {
      id: uuidv4(),
      jobId,
      type,
      timestamp: new Date().toISOString(),
      data,
    }
    events.push(event)
    this.events.set(jobId, events)
  }

  getRunningCount(): number {
    return this.running.size
  }

  getQueueLength(): number {
    return this.queue.length
  }
}

// Singleton job store
let jobStore: InMemoryJobStore | null = null

export function getJobStore(): InMemoryJobStore {
  if (!jobStore) {
    jobStore = new InMemoryJobStore()
  }
  return jobStore
}

// Job Manager class
export class JobManager {
  private store: InMemoryJobStore
  private logger: ReturnType<typeof getLogger>

  constructor() {
    this.store = getJobStore()
    this.logger = getLogger('JobManager')
    this.startJobProcessor()
  }

  // Create a new job
  createJob(input: JobInput): JobOutput {
    const validated = jobInputSchema.parse(input)
    const job = this.store.createJob(validated)
    this.logger.info({ jobId: job.id, prompt: job.prompt }, 'Job created')
    return job
  }

  // Get job by ID
  getJob(id: string): JobOutput | undefined {
    return this.store.getJob(id)
  }

  // Get all jobs
  getAllJobs(): JobOutput[] {
    return this.store.getAllJobs()
  }

  // Get jobs by status
  getJobsByStatus(status: JobStatus): JobOutput[] {
    return this.store.getJobsByStatus(status)
  }

  // Get job events
  getJobEvents(jobId: string): JobEvent[] {
    return this.store.getEvents(jobId)
  }

  // Get running jobs count
  getRunningCount(): number {
    return this.store.getRunningCount()
  }

  // Get queued jobs count
  getQueueLength(): number {
    return this.store.getQueueLength()
  }

  // Start processing jobs from queue
  private startJobProcessor(): void {
    setInterval(() => {
      this.processNextJob()
    }, 1000) // Check every second
  }

  private processNextJob(): void {
    const config = getConfig()

    // Check if we can run more jobs
    if (this.store.getRunningCount() >= parseInt(config.MAX_CONCURRENCY, 10)) {
      return
    }

    // Get next job from queue
    const job = this.store.getNextQueuedJob()
    if (!job) return

    // Mark as running
    this.store.startJob(job.id)
    this.logger.info({ jobId: job.id }, 'Job started')

    // Simulate job execution (Phase 3 will integrate Claude SDK)
    this.simulateJobExecution(job.id)
  }

  // Mock job execution for Phase 1
  private async simulateJobExecution(jobId: string): Promise<void> {
    // Simulate some work
    setTimeout(() => {
      const job = this.store.getJob(jobId)
      if (job && job.status === JobStatus.RUNNING) {
        this.store.completeJob(jobId, { message: 'Mock job completed successfully' })
        this.logger.info({ jobId }, 'Job completed')
      }
    }, 2000)
  }
}
