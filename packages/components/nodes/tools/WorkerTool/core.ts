import { Tool } from '@langchain/core/tools'

export interface WorkerToolParams {
  workerUrl: string
  workerRole?: string
  maxConcurrency?: number
}

export class WorkerTool extends Tool {
  name = 'worker_tool'
  description = 'Execute coding tasks using Claude Worker'

  private workerUrl: string
  private workerRole: string
  private maxConcurrency: number

  constructor(params: WorkerToolParams) {
    super()
    this.workerUrl = params.workerUrl
    this.workerRole = params.workerRole || 'coding'
    this.maxConcurrency = params.maxConcurrency || 2
  }

  async _call(input: string): Promise<string> {
    try {
      const response = await fetch(`${this.workerUrl}/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: input,
          workerType: this.workerRole,
        }),
      })

      if (!response.ok) {
        throw new Error(`Worker request failed: ${response.statusText}`)
      }

      const job = await response.json()

      // Poll for result
      const result = await this.pollForResult(job.id)

      return JSON.stringify(result)
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  private async pollForResult(jobId: string, maxAttempts = 60): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000))

      const response = await fetch(`${this.workerUrl}/jobs/${jobId}/result`)

      if (!response.ok) {
        continue
      }

      const result = await response.json()

      if (result.status === 'succeeded') {
        return result
      }

      if (result.status === 'failed') {
        throw new Error(result.error || 'Job failed')
      }
    }

    throw new Error('Job timed out')
  }
}
