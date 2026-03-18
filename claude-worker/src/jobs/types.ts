import { z } from 'zod'

// Job status enum
export enum JobStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  RUNNING = 'running',
  WAITING_APPROVAL = 'waiting_approval',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

// Job priority
export enum JobPriority {
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  URGENT = 4,
}

// Job input schema
export const jobInputSchema = z.object({
  prompt: z.string().min(1),
  workerType: z.enum(['coding', 'support']).optional().default('coding'),
  sessionId: z.string().optional(),
  priority: z.number().min(1).max(4).optional().default(JobPriority.NORMAL),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type JobInput = z.infer<typeof jobInputSchema>

// Job output schema
export const jobOutputSchema = z.object({
  id: z.string(),
  status: z.nativeEnum(JobStatus),
  prompt: z.string(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type JobOutput = z.infer<typeof jobOutputSchema>

// Job event types
export enum JobEventType {
  CREATED = 'created',
  UPDATED = 'updated',
  STARTED = 'started',
  OUTPUT = 'output',
  WAITING_APPROVAL = 'waiting_approval',
  APPROVAL_REQUIRED = 'approval_required',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  TOOL_REQUESTED = 'tool_requested',
  TOOL_RESULT = 'tool_result',
  ERROR = 'error',
}

export interface JobEvent {
  id: string
  jobId: string
  type: JobEventType
  timestamp: string
  sequence?: number
  data?: Record<string, unknown>
}
