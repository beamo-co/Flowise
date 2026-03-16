import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { getConfig } from '../config'
import { getLogger } from '../logger'
import { v4 as uuidv4 } from 'uuid'

const logger = getLogger('WorkspaceManager')

export interface RepoConfig {
  url: string
  branch?: string
  path: string // Local path where repo is cloned
}

export interface WorkspaceInfo {
  jobId: string
  repoPath: string
  worktreePath: string
  branch: string
  createdAt: Date
}

export class WorkspaceManager {
  private config: ReturnType<typeof getConfig>
  private reposDir: string
  private workspacesDir: string

  constructor() {
    this.config = getConfig()
    this.reposDir = path.join(this.config.DATA_ROOT, 'repos')
    this.workspacesDir = path.join(this.config.DATA_ROOT, 'workspaces')

    this.ensureDirectories()
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.reposDir)) {
      fs.mkdirSync(this.reposDir, { recursive: true })
      logger.info({ dir: this.reposDir }, 'Created repos directory')
    }

    if (!fs.existsSync(this.workspacesDir)) {
      fs.mkdirSync(this.workspacesDir, { recursive: true })
      logger.info({ dir: this.workspacesDir }, 'Created workspaces directory')
    }
  }

  // Get the persistent clone path for a repo
  getRepoPath(repoUrl: string): string {
    // Create a safe directory name from the URL
    const repoName = this.getRepoName(repoUrl)
    return path.join(this.reposDir, repoName)
  }

  // Clone or update a repo
  async ensureRepo(repoUrl: string, branch?: string): Promise<string> {
    const repoPath = this.getRepoPath(repoUrl)
    const branchToUse = branch || 'main'

    if (fs.existsSync(repoPath)) {
      // Repo exists, just ensure it's up to date
      logger.info({ repoPath, branch: branchToUse }, 'Repo already exists, checking status')
      try {
        execSync('git fetch origin', { cwd: repoPath, stdio: 'ignore' })
      } catch (e) {
        // Ignore fetch errors
      }
      return repoPath
    }

    // Clone the repo
    logger.info({ repoUrl, repoPath, branch: branchToUse }, 'Cloning repo')

    try {
      execSync(`git clone --bare ${repoUrl} .`, {
        cwd: this.reposDir,
        stdio: 'inherit',
      })
    } catch (error) {
      logger.error({ repoUrl, error }, 'Failed to clone repo')
      throw new Error(`Failed to clone repo: ${repoUrl}`)
    }

    return repoPath
  }

  // Create a worktree for a job
  async createWorktree(jobId: string, repoUrl: string, branch?: string): Promise<WorkspaceInfo> {
    const repoPath = this.getRepoPath(repoUrl)
    const worktreePath = path.join(this.workspacesDir, `job-${jobId}`)
    const branchName = branch || `job-${jobId}-${uuidv4().slice(0, 8)}`

    // Ensure the repo exists
    await this.ensureRepo(repoUrl, branch)

    // Create worktree directory
    if (fs.existsSync(worktreePath)) {
      logger.warn({ worktreePath }, 'Worktree already exists, removing')
      this.removeWorktree(jobId)
    }

    fs.mkdirSync(worktreePath, { recursive: true })

    // Create worktree from the repo
    try {
      execSync(`git worktree add ${worktreePath} ${branchName}`, {
        cwd: repoPath,
        stdio: 'inherit',
      })
    } catch (error) {
      // If worktree creation fails, try with main branch
      try {
        execSync(`git worktree add -b ${branchName} ${worktreePath} origin/main`, {
          cwd: repoPath,
          stdio: 'inherit',
        })
      } catch (retryError) {
        logger.error({ error: retryError }, 'Failed to create worktree')
        fs.rmdirSync(worktreePath, { recursive: true })
        throw new Error('Failed to create worktree')
      }
    }

    logger.info({ jobId, worktreePath, branch: branchName }, 'Worktree created')

    return {
      jobId,
      repoPath,
      worktreePath,
      branch: branchName,
      createdAt: new Date(),
    }
  }

  // Remove a worktree
  removeWorktree(jobId: string): boolean {
    const worktreePath = path.join(this.workspacesDir, `job-${jobId}`)

    if (!fs.existsSync(worktreePath)) {
      logger.warn({ jobId, worktreePath }, 'Worktree does not exist')
      return false
    }

    try {
      // Remove worktree
      execSync(`git worktree remove --force ${worktreePath}`, { stdio: 'ignore' })
      fs.rmdirSync(worktreePath, { recursive: true })
      logger.info({ jobId, worktreePath }, 'Worktree removed')
      return true
    } catch (error) {
      logger.error({ jobId, error }, 'Failed to remove worktree')
      return false
    }
  }

  // Validate that a path is within allowed roots
  validatePath(filePath: string): boolean {
    const allowedRoots = [
      this.config.DATA_ROOT,
      this.reposDir,
      this.workspacesDir,
    ]

    const resolvedPath = path.resolve(filePath)

    for (const root of allowedRoots) {
      if (resolvedPath.startsWith(path.resolve(root))) {
        return true
      }
    }

    logger.warn({ filePath, resolvedPath }, 'Path validation failed')
    return false
  }

  // Get repo name from URL
  private getRepoName(repoUrl: string): string {
    // Extract repo name from URL
    const match = repoUrl.match(/\/([^\/]+?)(?:\.git)?$/)
    return match ? match[1] : uuidv4()
  }

  // Get workspace info for a job
  getWorkspaceInfo(jobId: string): WorkspaceInfo | null {
    const worktreePath = path.join(this.workspacesDir, `job-${jobId}`)

    if (!fs.existsSync(worktreePath)) {
      return null
    }

    try {
      const branch = execSync('git branch --show-current', {
        cwd: worktreePath,
        encoding: 'utf-8',
      }).trim()

      const stats = fs.statSync(worktreePath)

      return {
        jobId,
        repoPath: '', // Would need to track this separately
        worktreePath,
        branch,
        createdAt: stats.birthtime,
      }
    } catch (error) {
      logger.error({ jobId, error }, 'Failed to get workspace info')
      return null
    }
  }
}

// Singleton instance
let workspaceManager: WorkspaceManager | null = null

export function getWorkspaceManager(): WorkspaceManager {
  if (!workspaceManager) {
    workspaceManager = new WorkspaceManager()
  }
  return workspaceManager
}
