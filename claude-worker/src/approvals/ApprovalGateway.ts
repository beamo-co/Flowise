import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/database'
import { getLogger } from '../logger'
import { JobStatus, JobEventType } from '../jobs/types'
import { eventRepository } from '../repositories'

const logger = getLogger('ApprovalGateway')

export interface Approval {
  id: string
  job_id: string
  tool_name: string
  description: string
  status: ApprovalStatus
  requested_at: Date
  responded_at?: Date
  response?: string
}

export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export interface ApprovalRequest {
  jobId: string
  toolName: string
  description: string
  details?: Record<string, unknown>
}

export class ApprovalGateway {
  private pendingApprovals: Map<string, Approval> = new Map()

  // Request approval for a tool
  async requestApproval(request: ApprovalRequest): Promise<Approval> {
    const db = getDatabase()
    const id = uuidv4()
    const now = new Date().toISOString()

    const stmt = db.prepare(`
      INSERT INTO approvals (id, job_id, tool_name, description, status, requested_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    stmt.run(id, request.jobId, request.toolName, request.description, ApprovalStatus.PENDING, now)

    const approval: Approval = {
      id,
      job_id: request.jobId,
      tool_name: request.toolName,
      description: request.description,
      status: ApprovalStatus.PENDING,
      requested_at: new Date(now),
    }

    this.pendingApprovals.set(id, approval)

    // Update job status to waiting_approval
    db.prepare(`
      UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?
    `).run(JobStatus.WAITING_APPROVAL, now, request.jobId)

    // Emit approval required event
    eventRepository.create(request.jobId, JobEventType.APPROVAL_REQUIRED, {
      approvalId: id,
      toolName: request.toolName,
      description: request.description,
      details: request.details,
    })

    logger.info({ approvalId: id, jobId: request.jobId, tool: request.toolName }, 'Approval requested')

    return approval
  }

  // Get approval by ID
  getApproval(id: string): Approval | null {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as ApprovalRow | undefined

    if (!row) {
      return null
    }

    return this.mapRowToApproval(row)
  }

  // Get pending approvals for a job
  getPendingApprovalsForJob(jobId: string): Approval[] {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT * FROM approvals WHERE job_id = ? AND status = ?
    `).all(jobId, ApprovalStatus.PENDING) as ApprovalRow[]

    return rows.map(row => this.mapRowToApproval(row))
  }

  // Approve or reject an approval
  async respondToApproval(approvalId: string, approved: boolean, response?: string): Promise<Approval | null> {
    const db = getDatabase()
    const approval = this.getApproval(approvalId)

    if (!approval) {
      logger.warn({ approvalId }, 'Approval not found')
      return null
    }

    if (approval.status !== ApprovalStatus.PENDING) {
      logger.warn({ approvalId, status: approval.status }, 'Approval already responded')
      return null
    }

    const now = new Date().toISOString()
    const newStatus = approved ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED

    // Update approval
    db.prepare(`
      UPDATE approvals SET status = ?, responded_at = ?, response = ? WHERE id = ?
    `).run(newStatus, now, response || null, approvalId)

    // Update job status back to running
    db.prepare(`
      UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?
    `).run(JobStatus.RUNNING, now, approval.job_id)

    // Emit approval event
    eventRepository.create(approval.job_id, approved ? JobEventType.APPROVED : JobEventType.REJECTED, {
      approvalId,
      toolName: approval.tool_name,
      response: response || (approved ? 'Approved' : 'Rejected'),
    })

    this.pendingApprovals.delete(approvalId)

    logger.info({ approvalId, jobId: approval.job_id, approved }, 'Approval responded')

    return this.getApproval(approvalId)
  }

  // Get all approvals
  getAllApprovals(): Approval[] {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM approvals ORDER BY requested_at DESC').all() as ApprovalRow[]
    return rows.map(row => this.mapRowToApproval(row))
  }

  // Get approvals by job ID
  getApprovalsByJobId(jobId: string): Approval[] {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM approvals WHERE job_id = ? ORDER BY requested_at DESC').all(jobId) as ApprovalRow[]
    return rows.map(row => this.mapRowToApproval(row))
  }

  private mapRowToApproval(row: ApprovalRow): Approval {
    return {
      id: row.id,
      job_id: row.job_id,
      tool_name: row.tool_name,
      description: row.description,
      status: row.status as ApprovalStatus,
      requested_at: new Date(row.requested_at),
      responded_at: row.responded_at ? new Date(row.responded_at) : undefined,
      response: row.response || undefined,
    }
  }
}

interface ApprovalRow {
  id: string
  job_id: string
  tool_name: string
  description: string
  status: string
  requested_at: string
  responded_at: string | null
  response: string | null
}

// Singleton instance
let approvalGateway: ApprovalGateway | null = null

export function getApprovalGateway(): ApprovalGateway {
  if (!approvalGateway) {
    approvalGateway = new ApprovalGateway()
  }
  return approvalGateway
}
