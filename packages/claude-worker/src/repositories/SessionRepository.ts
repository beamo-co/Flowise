import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/database'
import { getLogger } from '../logger'

const logger = getLogger('SessionRepository')

export interface Session {
  id: string
  namespace: string
  job_id: string | null
  metadata: Record<string, unknown> | null
  created_at: Date
  updated_at: Date
}

export interface CreateSessionParams {
  namespace: string
  jobId?: string
  metadata?: Record<string, unknown>
}

export class SessionRepository {
  create(params: CreateSessionParams): Session {
    const db = getDatabase()
    const id = uuidv4()
    const now = new Date().toISOString()

    const stmt = db.prepare(`
      INSERT INTO sessions (id, namespace, job_id, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      params.namespace,
      params.jobId || null,
      params.metadata ? JSON.stringify(params.metadata) : null,
      now,
      now
    )

    logger.info({ sessionId: id, namespace: params.namespace }, 'Session created')

    return this.getById(id)!
  }

  getById(id: string): Session | null {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined

    if (!row) {
      return null
    }

    return this.mapRowToSession(row)
  }

  getByNamespace(namespace: string): Session[] {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT * FROM sessions WHERE namespace = ? ORDER BY created_at DESC
    `).all(namespace) as SessionRow[]

    return rows.map(row => this.mapRowToSession(row))
  }

  getByJobId(jobId: string): Session | null {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM sessions WHERE job_id = ?').get(jobId) as SessionRow | undefined

    if (!row) {
      return null
    }

    return this.mapRowToSession(row)
  }

  update(id: string, params: Partial<CreateSessionParams>): Session | null {
    const db = getDatabase()
    const session = this.getById(id)

    if (!session) {
      return null
    }

    const updates: string[] = []
    const values: (string | null)[] = []

    if (params.jobId !== undefined) {
      updates.push('job_id = ?')
      values.push(params.jobId)
    }

    if (params.metadata !== undefined) {
      updates.push('metadata = ?')
      values.push(JSON.stringify(params.metadata))
    }

    if (updates.length === 0) {
      return session
    }

    updates.push('updated_at = ?')
    values.push(new Date().toISOString())
    values.push(id)

    const stmt = db.prepare(`
      UPDATE sessions SET ${updates.join(', ')} WHERE id = ?
    `)

    stmt.run(...values)

    return this.getById(id)
  }

  delete(id: string): boolean {
    const db = getDatabase()
    const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    return result.changes > 0
  }

  private mapRowToSession(row: SessionRow): Session {
    return {
      id: row.id,
      namespace: row.namespace,
      job_id: row.job_id,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }
  }
}

interface SessionRow {
  id: string
  namespace: string
  job_id: string | null
  metadata: string | null
  created_at: string
  updated_at: string
}

export const sessionRepository = new SessionRepository()
