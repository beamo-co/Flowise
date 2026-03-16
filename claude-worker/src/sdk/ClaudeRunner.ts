import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
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
  error?: string
}

export class ClaudeRunner {
  constructor() {
    logger.info('ClaudeRunner initialized with Claude Agent SDK')
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

    try {
      // Clear Claude Code environment variable to allow nested invocation
      delete process.env.CLAUDECODE

      const outputParts: string[] = []

      const queryOptions: Options = {
        pathToClaudeCodeExecutable: 'claude',
        cwd: workspacePath || process.cwd(),
        permissionMode: 'bypassPermissions',
      }

      logger.info({ jobId }, 'Executing Claude query via SDK')

      const stream = query({
        prompt,
        options: queryOptions,
      })

      // Process streaming response
      for await (const msg of stream as any) {
        const msgType = msg.type

        if (msgType === 'assistant') {
          if (msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text) {
                outputParts.push(block.text)
              }
            }
          }
          onEvent?.({ type: 'assistant', data: msg as unknown as Record<string, unknown> })
        } else if (msgType === 'tool_use') {
          logger.info({ jobId, toolName: msg.toolName }, 'Tool requested')
          eventRepository.create(jobId, JobEventType.TOOL_REQUESTED, {
            toolName: msg.toolName,
            toolInput: msg.input,
          })
          onEvent?.({ type: 'tool_use', data: msg as unknown as Record<string, unknown> })
        } else if (msgType === 'tool_result') {
          logger.info({ jobId }, 'Tool result received')
          eventRepository.create(jobId, JobEventType.TOOL_RESULT, {
            toolName: msg.toolName,
            result: msg.result,
          })
          onEvent?.({ type: 'tool_result', data: msg as unknown as Record<string, unknown> })
        } else if (msgType === 'message_start') {
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
        }
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
