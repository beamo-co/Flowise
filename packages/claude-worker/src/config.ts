import { z } from 'zod'

// Environment configuration schema
const configSchema = z.object({
  // Server
  PORT: z.string().default('3001'),

  // Worker configuration
  WORKER_ROLE: z.enum(['coding', 'support']).default('coding'),
  SESSION_NAMESPACE: z.string().default('default'),
  DATA_ROOT: z.string().default('/data'),
  MAX_CONCURRENCY: z.string().default('2'),

  // Optional: Claude Code CLI path
  CLAUDE_CODE_PATH: z.string().optional(),

  // Database
  DATABASE_PATH: z.string().default('/data/worker.db'),
})

export type Config = z.infer<typeof configSchema>

// Singleton config instance
let configInstance: Config | null = null

export function loadConfig(): Config {
  if (configInstance) {
    return configInstance
  }

  const env = {
    PORT: process.env.PORT || '3001',
    WORKER_ROLE: process.env.WORKER_ROLE || 'coding',
    SESSION_NAMESPACE: process.env.SESSION_NAMESPACE || 'default',
    DATA_ROOT: process.env.DATA_ROOT || '/data',
    MAX_CONCURRENCY: process.env.MAX_CONCURRENCY || '2',
    CLAUDE_CODE_PATH: process.env.CLAUDE_CODE_PATH,
    DATABASE_PATH: process.env.DATABASE_PATH || `${process.env.DATA_ROOT || '/data'}/worker.db`,
  }

  configInstance = configSchema.parse(env)
  return configInstance
}

export function getConfig(): Config {
  if (!configInstance) {
    return loadConfig()
  }
  return configInstance
}
