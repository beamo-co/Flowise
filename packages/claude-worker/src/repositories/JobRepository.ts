import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/database'
import { getLogger } from '../logger'
import { JobStatus, JobInput } from '../jobs/types'

const logger = getLogger('JobRepository')

export interface Job {
  id: string
  role: string
  status: JobStatus
  input: JobInput
  output?: JobOutput
  workspace_path?: string
  session_id?: string
  created_at: Date
  updated_at: Date
  started_at?: Date
  completed_at?: Date
}

export interface JobOutput {
  message?: string
  error?: string
  [key: string]: unknown
}

export interface CreateJobParams {
  role: string
  input: JobInput
}

export interface UpdateJobParams {
  status?: JobStatus
  output?: JobOutput
  workspace_path?: string
  session_id?: string
  started_at?: Date
  completed_at?: Date
}

export class JobRepository {
  create(params: CreateJobParams): Job {
    const db = getDatabase()
    const id = uuidv4()
    const now = new Date().toISOString()

    const stmt = db.prepare(`
      INSERT INTO jobs (id, role, status, input, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    stmt.run(id, params.role, 'pending', JSON.stringify(params.input), now, now)

    logger.info({ jobId: id, role: params.role }, 'Job created')

    return this.getById(id)!
  }

  getById(id: string): Job | null {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined

    if (!row) {
      return null
    }

    return this.mapRowToJob(row)
  }

  getAll(): Job[] {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as JobRow[]
    return rows.map(row => this.mapRowToJob(row))
  }

  getByStatus(status: JobStatus): Job[] {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC').all(status) as JobRow[]
    return rows.map(row => this.mapRowToJob(row))
  }

  update(id: string, params: UpdateJobParams): Job | null {
    const db = getDatabase()
    const job = this.getById(id)

    if (!job) {
      return null
    }

    const updates: string[] = []
    const values: (string | null)[] = []

    if (params.status !== undefined) {
      updates.push('status = ?')
      values.push(params.status)
    }

    if (params.output !== undefined) {
      updates.push('output = ?')
      values.push(JSON.stringify(params.output))
    }

    if (params.workspace_path !== undefined) {
      updates.push('workspace_path = ?')
      values.push(params.workspace_path)
    }

    if (params.session_id !== undefined) {
      updates.push('session_id = ?')
      values.push(params.session_id)
    }

    if (params.started_at !== undefined) {
      updates.push('started_at = ?')
      values.push(params.started_at.toISOString())
    }

    if (params.completed_at !== undefined) {
      updates.push('completed_at = ?')
      values.push(params.completed_at.toISOString())
    }

    if (updates.length === 0) {
      return job
    }

    updates.push('updated_at = ?')
    values.push(new Date().toISOString())
    values.push(id)

    const stmt = db.prepare(`
      UPDATE jobs SET ${updates.join(', ')} WHERE id = ?
    `)

    stmt.run(...values)

    logger.info({ jobId: id, updates: params }, 'Job updated')

    return this.getById(id)
  }

  delete(id: string): boolean {
    const db = getDatabase()
    const result = db.prepare('DELETE FROM jobs WHERE id = ?').run(id)
    return result.changes > 0
  }

  private mapRowToJob(row: JobRow): Job {
    return {
      id: row.id,
      role: row.role,
      status: row.status as JobStatus,
      input: JSON.parse(row.input),
      output: row.output ? JSON.parse(row.output) : undefined,
      workspace_path: row.workspace_path || undefined,
      session_id: row.session_id || undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      started_at: row.started_at ? new Date(row.started_at) : undefined,
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
    }
  }
}

interface JobRow {
  id: string
  role: string
  status: string
  input: string
  output: string | null
  workspace_path: string | null
  session_id: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
}

export const jobRepository = new JobRepository()
