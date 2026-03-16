import { getDatabase } from '../db/database'
import { getLogger } from '../logger'

const logger = getLogger('EventRepository')

export interface JobEvent {
  id: string
  job_id: string
  event_type: string
  payload: object
  sequence: number
  created_at: Date
}

export class EventRepository {
  create(jobId: string, eventType: string, payload: object): JobEvent {
    const db = getDatabase()

    // Get the next sequence number for this job
    const seqResult = db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq FROM job_events WHERE job_id = ?
    `).get(jobId) as { next_seq: number }

    const seq = seqResult.next_seq
    const now = new Date().toISOString()

    const stmt = db.prepare(`
      INSERT INTO job_events (job_id, event_type, payload, sequence, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    const result = stmt.run(jobId, eventType, JSON.stringify(payload), seq, now)

    logger.debug({ jobId, eventType, sequence: seq }, 'Job event created')

    return {
      id: result.lastInsertRowid.toString(),
      job_id: jobId,
      event_type: eventType,
      payload,
      sequence: seq,
      created_at: new Date(now),
    }
  }

  getByJobId(jobId: string): JobEvent[] {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT * FROM job_events WHERE job_id = ? ORDER BY sequence ASC
    `).all(jobId) as EventRow[]

    return rows.map(row => ({
      id: row.id.toString(),
      job_id: row.job_id,
      event_type: row.event_type,
      payload: JSON.parse(row.payload),
      sequence: row.sequence,
      created_at: new Date(row.created_at),
    }))
  }

  getByJobIdSince(jobId: string, sinceSequence: number): JobEvent[] {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT * FROM job_events WHERE job_id = ? AND sequence > ? ORDER BY sequence ASC
    `).all(jobId, sinceSequence) as EventRow[]

    return rows.map(row => ({
      id: row.id.toString(),
      job_id: row.job_id,
      event_type: row.event_type,
      payload: JSON.parse(row.payload),
      sequence: row.sequence,
      created_at: new Date(row.created_at),
    }))
  }

  deleteByJobId(jobId: string): void {
    const db = getDatabase()
    db.prepare('DELETE FROM job_events WHERE job_id = ?').run(jobId)
    logger.debug({ jobId }, 'Job events deleted')
  }
}

interface EventRow {
  id: number
  job_id: string
  event_type: string
  payload: string
  sequence: number
  created_at: string
}

export const eventRepository = new EventRepository()
