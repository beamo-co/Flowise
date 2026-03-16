import { Anthropic } from '@anthropic-ai/sdk'
import { getConfig } from '../config'
import { getLogger } from '../logger'
import { JobInput, JobEventType } from '../jobs/types'
import { eventRepository } from '../repositories'
import { sessionRepository } from '../repositories/SessionRepository'

const logger = getLogger('ClaudeRunner')

export interface RunOptions {
  jobId: string
  prompt: string
  workspacePath?: string
  sessionId?: string
  resume?: boolean
  permissionMode?: 'auto' | 'ask'
  onEvent?: (event: ClaudeEvent) => void
}

export interface ClaudeEvent {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop' | 'error' | 'tool_use' | 'tool_result'
  data: Record<string, unknown>
}

export interface RunResult {
  sessionId: string
  output: string
  error?: string
}

export class ClaudeRunner {
  private client: Anthropic

  constructor() {
    const config = getConfig()
    const apiKey = process.env.ANTHROPIC_API_KEY

    if (!apiKey) {
      logger.warn('ANTHROPIC_API_KEY not set, Claude SDK will not work')
    }

    this.client = new Anthropic({
      apiKey: apiKey || 'dummy-key-for-type-check',
    })
  }

  async run(options: RunOptions): Promise<RunResult> {
    const { jobId, prompt, workspacePath, sessionId, resume = false, permissionMode = 'ask', onEvent } = options
    const config = getConfig()

    logger.info({ jobId, workspacePath, resume, permissionMode }, 'Starting Claude run')

    // Create or resume session
    let currentSessionId = sessionId

    if (!currentSessionId) {
      // Create new session in database
      const session = sessionRepository.create({
        namespace: config.SESSION_NAMESPACE,
        jobId,
      })
      currentSessionId = session.id
      eventRepository.create(jobId, JobEventType.CREATED, { sessionId: currentSessionId })
    }

    try {
      // For local Claude Code execution, we'd use claude-agent-sdk
      // But for this implementation, we'll simulate with API calls
      // In production, this would use the actual Claude Code SDK

      const response = await this.client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        system: [
          {
            type: 'text',
            text: this.getSystemPrompt(config.WORKER_ROLE),
          },
        ],
      })

      // Extract output text
      const outputText = this.extractTextFromResponse(response)

      // Save session mapping
      if (currentSessionId) {
        sessionRepository.update(currentSessionId, { jobId })
      }

      eventRepository.create(jobId, JobEventType.SUCCEEDED, {
        sessionId: currentSessionId,
        output: outputText,
      })

      logger.info({ jobId, sessionId: currentSessionId }, 'Claude run completed')

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

  private getSystemPrompt(role: string): string {
    switch (role) {
      case 'coding':
        return `You are an expert coding assistant. Your role is to help with code-related tasks including:
- Writing and editing code
- Debugging and fixing issues
- Creating pull requests
- Code reviews
- Running tests

Always use best practices and write clean, maintainable code.`
      case 'support':
        return `You are a customer support assistant. Your role is to help customers with:
- Answering questions
- Troubleshooting issues
- Providing documentation guidance
- Escalating complex issues when needed

Be polite, helpful, and accurate.`
      default:
        return `You are a helpful AI assistant.`
    }
  }

  private extractTextFromResponse(response: any): string {
    const textParts: string[] = []

    if (response.content) {
      for (const block of response.content) {
        if (block.type === 'text') {
          textParts.push(block.text)
        }
      }
    }

    return textParts.join('\n')
  }

  // Check if API key is configured
  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY
  }
}

// Singleton instance
let claudeRunner: ClaudeRunner | null = null

export function getClaudeRunner(): ClaudeRunner {
  if (!claudeRunner) {
    claudeRunner = new ClaudeRunner()
  }
  return claudeRunner
}
