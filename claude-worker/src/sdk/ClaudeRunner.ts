import { query, type Options, type Query } from '@anthropic-ai/claude-agent-sdk'
import fs from 'fs'
import path from 'path'
import { getConfig } from '../config'
import { getLogger } from '../logger'
import { JobEventType } from '../jobs/types'
import { eventRepository } from '../repositories'
import { sessionRepository } from '../repositories/SessionRepository'
import { getWorkspaceManager } from '../workspace'

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
  error?: string
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

    // If no workspace path provided, create one based on sessionId
    let workDir = workspacePath
    if (!workDir && currentSessionId) {
      const workspaceManager = getWorkspaceManager()
      // Create a session-based workspace directory (no repo, just a directory)
      const sessionsDir = workspaceManager.getSessionsDir()
      workDir = sessionsDir

      // Create session-specific subdirectory
      const sessionWorkDir = `${sessionsDir}/session-${currentSessionId}`
      const fs = await import('fs')
      if (!fs.existsSync(sessionWorkDir)) {
        fs.mkdirSync(sessionWorkDir, { recursive: true })
      }
      workDir = sessionWorkDir
      logger.info({ jobId, sessionId: currentSessionId, workDir }, 'Created session workspace')
    }

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
      const queryOptions: Options = {
        pathToClaudeCodeExecutable: 'claude',
        cwd: sessionDir,
        permissionMode: 'bypassPermissions',
        // Use resume for existing sessions, sessionId for new sessions
        ...(sessionExists ? { resume: currentSessionId } : { sessionId: currentSessionId }),
      }
      logger.info({ jobId, sessionId: currentSessionId, sessionExists, queryOptions }, 'Claude query options')

      logger.info({ jobId }, 'Executing Claude query via SDK')

      const stream = query({
        prompt,
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

        return {
          sessionId: currentSessionId,
          output: outputText,
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
