import { query, type Options, type Query } from '@anthropic-ai/claude-agent-sdk'
import path from 'path'
import { getConfig } from '../config'
import { getLogger } from '../logger'
import { JobEventType } from '../jobs/types'
import { eventRepository } from '../repositories'
import { sessionRepository } from '../repositories/SessionRepository'

const logger = getLogger('ClaudeRunner')

export interface RunOptions {
  jobId: string
  prompt: string
  workspacePath?: string
  sessionId?: string
  resume?: boolean
  permissionMode?: 'auto' | 'ask' | 'default'
  onEvent?: (event: ClaudeEvent) => void
}

export interface ClaudeEvent {
  type: string
  data: Record<string, unknown>
}

export interface RunResult {
  sessionId: string
  output: string
  prUrl?: string
  error?: string
}

/**
 * Build the unified prompt based on role.
 */
function buildPrompt(userPrompt: string, sessionId: string, workerRole: string): string {
  if (workerRole === 'coding') {
    const worktreeBaseDir = `/data/workspaces/session-${sessionId}`
    return `You are a code modification agent.

## Request
${userPrompt}

## Workspace
Worktree directory: ${worktreeBaseDir}
All your work MUST be done inside this directory.

## CRITICAL: Read the root CLAUDE.md to understand all available repos before taking any action.

## Workflow Decision
Based on the request above, determine which workflow to use:

### Workflow A: Create New PR (use when request is asking for NEW code changes)
- cd to the target repo, git checkout main && git pull
- Create a worktree with a new branch under ${worktreeBaseDir}:
  \`git worktree add -b ai/<branch_name> ${worktreeBaseDir}/<branch_name> origin/main\`
- cd into the worktree directory
- Make code changes
- git add, git commit, git push
- gh pr create
- Output: PR_URL:<url>

### Workflow B: Update Existing PR (use when request mentions an EXISTING PR URL, PR number, or review comments)
- Parse the PR URL or number from the request
- NEVER create a new branch - checkout the EXISTING branch from the PR
- Run \`gh pr view --json headRefName,baseRefName\` to get the EXISTING branch name
- Create worktree using the EXISTING branch: \`git worktree add ${worktreeBaseDir}/<existing_branch_name> origin/<existing_branch_name>\`
- cd into the worktree directory
- Make fixes based on the comments
- git add, git commit, git push (NOT gh pr create)
- Output: ORIGINAL_PR_URL:<url>

## IMPORTANT
- Use Workflow B if the request contains a PR URL or mentions existing PR comments
- Use Workflow A for all other cases
- NEVER run \`gh pr create\` when updating an existing PR
- Output the PR URL at the very end of your response`
  }

  // Support agent
  return `You are a support agent.

## Request
${userPrompt}

## Session ID: ${sessionId}
`
}

// Track active queries by sessionId for interruption support
const activeQueries = new Map<string, { query: Query; jobId: string }>()

export class ClaudeRunner {
  constructor() {
    logger.info('ClaudeRunner initialized with Claude Agent SDK')
  }

  /**
   * Interrupt an existing query for a given sessionId
   */
  interruptSession(sessionId: string): void {
    const active = activeQueries.get(sessionId)
    if (active) {
      logger.info({ sessionId, jobId: active.jobId }, 'Interrupting existing query')
      active.query.close()
      activeQueries.delete(sessionId)
    }
  }

  async run(options: RunOptions): Promise<RunResult> {
    const { jobId, prompt, workspacePath, sessionId, resume = false, permissionMode = 'default', onEvent } = options
    const config = getConfig()

    logger.info({ jobId, workspacePath, resume, permissionMode }, 'Starting Claude run')

    // Create or resume session
    let currentSessionId = sessionId

    if (!currentSessionId) {
      const session = sessionRepository.create({
        namespace: config.SESSION_NAMESPACE,
        jobId,
      })
      currentSessionId = session.id
      eventRepository.create(jobId, JobEventType.CREATED, { sessionId: currentSessionId })
    }

    // Interrupt any existing query for this session
    this.interruptSession(currentSessionId)

    // If no workspace path provided, use the configured workspace directory
    const workspaceDir = config.WORKSPACE_DIR
    const workDir = workspacePath || workspaceDir
    logger.info({ jobId, sessionId: currentSessionId, workDir, workspaceDir }, 'Using workspace directory')

    try {
      // Clear Claude Code environment variable to allow nested invocation
      delete process.env.CLAUDECODE

      const outputParts: string[] = []

      // Check if session exists - Claude stores sessions in .claude/projects/ directories
      const fs = await import('fs')
      const sessionDir = workDir || workspacePath || process.cwd()
      let sessionExists = false

      // Check if session file exists in Claude's project directories
      const claudeProjectsDir = path.join(process.env.HOME || '/home/nodejs', '.claude', 'projects')
      if (fs.existsSync(claudeProjectsDir)) {
        try {
          const projects = fs.readdirSync(claudeProjectsDir, { withFileTypes: true })
          for (const project of projects) {
            if (project.isDirectory()) {
              const sessionFile = path.join(claudeProjectsDir, project.name, `${currentSessionId}.jsonl`)
              if (fs.existsSync(sessionFile)) {
                sessionExists = true
                break
              }
            }
          }
        } catch (e) {
          // Ignore errors, assume session doesn't exist
        }
      }

      // sessionId creates a new session with that ID
      // resume resumes an existing session by ID
      // Build allowed directories: /data/repos for repos, /data/workspaces for worktrees
      const allowedDirs = ['/data/repos', '/data/workspaces']
      // Add session-specific worktree directory if it already exists
      if (currentSessionId) {
        const sessionWorktreeDir = `/data/workspaces/session-${currentSessionId}`
        if (fs.existsSync(sessionWorktreeDir)) {
          allowedDirs.push(sessionWorktreeDir)
        }
      }
      const queryOptions: Options = {
        pathToClaudeCodeExecutable: 'claude',
        cwd: sessionDir,
        permissionMode: 'bypassPermissions',
        model: config.MODEL,
        // Use resume for existing sessions, sessionId for new sessions
        ...(sessionExists ? { resume: currentSessionId } : { sessionId: currentSessionId }),
        // Restrict Claude Code to only access allowed directories
        extraArgs: {
          'add-dir': allowedDirs.join(','),
        },
      }
      logger.info({ jobId, sessionId: currentSessionId, sessionExists, queryOptions }, 'Claude query options')

      logger.info({ jobId }, 'Executing Claude query via SDK')

      const fullPrompt = buildPrompt(prompt, currentSessionId || '', config.WORKER_ROLE)
      logger.info({ jobId, fullPromptLength: fullPrompt.length }, 'Built prompt')

      const stream = query({
        prompt: fullPrompt,
        options: queryOptions,
      })

      // Track this query for interruption support
      activeQueries.set(currentSessionId, { query: stream as Query, jobId })

      try {
        // Process streaming response
        for await (const msg of stream as any) {
          const msgType = msg.type

          if (msgType === 'assistant') {
            if (msg.message?.content) {
              for (const block of msg.message.content) {
                // Handle thinking blocks
                if (block.type === 'thinking' && block.thinking) {
                  const thinkingText = typeof block.thinking === 'string' ? block.thinking : JSON.stringify(block.thinking)
                  outputParts.push(`[Thinking]: ${thinkingText}`)
                  logger.info({ jobId, thinking: thinkingText.substring(0, 500) }, 'Claude thinking')
                  eventRepository.create(jobId, JobEventType.OUTPUT, {
                    type: 'thinking',
                    content: thinkingText,
                  })
                }
                // Handle text blocks
                if (block.type === 'text' && block.text) {
                  outputParts.push(block.text)
                }
              }
            }
            onEvent?.({ type: 'assistant', data: msg as unknown as Record<string, unknown> })
          } else if (msgType === 'tool_use') {
            logger.info({ jobId, toolName: msg.toolName, toolInput: msg.input }, 'Tool requested')
            eventRepository.create(jobId, JobEventType.TOOL_REQUESTED, {
              toolName: msg.toolName,
              toolInput: msg.input,
            })
            onEvent?.({ type: 'tool_use', data: msg as unknown as Record<string, unknown> })
          } else if (msgType === 'tool_result') {
            logger.info({ jobId, toolName: msg.toolName, result: msg.result?.substring(0, 500) }, 'Tool result received')
            eventRepository.create(jobId, JobEventType.TOOL_RESULT, {
              toolName: msg.toolName,
              result: msg.result,
            })
            onEvent?.({ type: 'tool_result', data: msg as unknown as Record<string, unknown> })
          } else if (msgType === 'message_start') {
            logger.info({ jobId }, 'Message started')
            eventRepository.create(jobId, JobEventType.STARTED, {})
            onEvent?.({ type: 'message_start', data: msg as unknown as Record<string, unknown> })
          } else if (msgType === 'message_stop') {
            logger.info({ jobId }, 'Claude execution completed')
            eventRepository.create(jobId, JobEventType.SUCCEEDED, {})
            onEvent?.({ type: 'message_stop', data: msg as unknown as Record<string, unknown> })
          } else if (msgType === 'error') {
            const errorMsg = msg.error?.message || 'Unknown error'
            logger.error({ jobId, error: errorMsg }, 'Claude error')
            eventRepository.create(jobId, JobEventType.ERROR, { error: errorMsg })
            onEvent?.({ type: 'error', data: msg as unknown as Record<string, unknown> })
          } else {
            // Log all other event types for debugging
            logger.debug({ jobId, msgType }, 'Received other SDK event')
          }
        }

        // Clean up active query tracking on success
        if (currentSessionId) {
          activeQueries.delete(currentSessionId)
        }

        const outputText = outputParts.join('\n')

        if (currentSessionId) {
          sessionRepository.update(currentSessionId, { jobId })
        }

        logger.info({ jobId, sessionId: currentSessionId, outputLength: outputText.length }, 'Claude run completed')

        // Extract PR URL from output
        let prUrl: string | undefined
        const prUrlMatch = outputText.match(/(?:ORIGINAL_)?PR_URL:?\s*(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+)/)
        if (prUrlMatch) {
          prUrl = prUrlMatch[1]
          logger.info({ jobId, prUrl }, 'PR URL extracted')
        }

        return {
          sessionId: currentSessionId,
          output: outputText,
          prUrl,
        }
      } catch (error) {
        // Clean up active query tracking on error
        if (currentSessionId) {
          activeQueries.delete(currentSessionId)
        }

        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        logger.error({ jobId, error: errorMessage }, 'Claude run failed')

        eventRepository.create(jobId, JobEventType.FAILED, {
          sessionId: currentSessionId,
          error: errorMessage,
        })

        return {
          sessionId: currentSessionId || '',
          output: '',
          prUrl: undefined,
          error: errorMessage,
        }
      }
    } catch (error) {
      // Outer catch for any unexpected errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error({ jobId, error: errorMessage }, 'Unexpected error in run')
      return {
        sessionId: currentSessionId || '',
        output: '',
        prUrl: undefined,
        error: errorMessage,
      }
    }
  }

  isConfigured(): boolean {
    return true
  }
}

let claudeRunner: ClaudeRunner | null = null

export function getClaudeRunner(): ClaudeRunner {
  if (!claudeRunner) {
    claudeRunner = new ClaudeRunner()
  }
  return claudeRunner
}
