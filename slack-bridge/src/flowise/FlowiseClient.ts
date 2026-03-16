import axios, { AxiosInstance } from 'axios'
import { logger } from '../logger'

export interface FlowiseConfig {
  baseUrl: string
  apiKey?: string
}

export interface FlowisePredictionRequest {
  question: string
  chatId?: string
  overrideConfig?: Record<string, any>
}

export interface FlowisePredictionResponse {
  sessionId?: string
  text: string
  [key: string]: any
}

export class FlowiseClient {
  private client: AxiosInstance

  constructor(config: FlowiseConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 300000, // 5 minutes for long-running predictions
      headers: config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : {},
    })
    logger.info({ baseUrl: config.baseUrl }, 'Flowise client initialized')
  }

  // Send a prediction request
  async predict(
    chatflowId: string,
    request: FlowisePredictionRequest
  ): Promise<FlowisePredictionResponse> {
    try {
      const response = await this.client.post<FlowisePredictionResponse>(
        `/api/v1/prediction/${chatflowId}`,
        request
      )

      return response.data
    } catch (error) {
      logger.error({ error, chatflowId }, 'Failed to get prediction')
      throw error
    }
  }

  // Get chatflow by ID
  async getChatflow(chatflowId: string): Promise<any> {
    try {
      const response = await this.client.get(`/api/v1/chatflows/${chatflowId}`)
      return response.data
    } catch (error) {
      logger.error({ error, chatflowId }, 'Failed to get chatflow')
      throw error
    }
  }

  // Get chat history
  async getChatHistory(sessionId: string, limit = 10): Promise<any[]> {
    try {
      const response = await this.client.get(`/api/v1/chatmessages/${sessionId}`, {
        params: { limit },
      })
      return response.data
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to get chat history')
      throw error
    }
  }

  // Stream prediction (returns an async iterator)
  async *streamPredict(
    chatflowId: string,
    request: FlowisePredictionRequest
  ): AsyncGenerator<string> {
    try {
      const response = await this.client.post(
        `/api/v1/prediction/${chatflowId}`,
        request,
        {
          responseType: 'stream',
        }
      )

      for await (const chunk of response.data) {
        yield chunk.toString()
      }
    } catch (error) {
      logger.error({ error, chatflowId }, 'Failed to stream prediction')
      throw error
    }
  }
}

export function createFlowiseClient(): FlowiseClient | null {
  const baseUrl = process.env.FLOWISE_URL || 'http://localhost:3000'
  const apiKey = process.env.FLOWISE_SECRETKEY

  return new FlowiseClient({
    baseUrl,
    apiKey,
  })
}
