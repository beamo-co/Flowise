import pino from 'pino'
import { getConfig } from './config'
import path from 'path'
import fs from 'fs'

// Log levels
export enum LogLevel {
  TRACE = 'trace',
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

// Create logs directory if it doesn't exist
function ensureLogDirectory(logPath: string): void {
  const dir = path.dirname(logPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// Create logger instance
export function createLogger(service: string = 'claude-worker') {
  const config = getConfig()
  const logDir = path.join(config.DATA_ROOT, 'logs')
  const logFile = path.join(logDir, `${service}.log`)

  // Ensure log directory exists
  ensureLogDirectory(logFile)

  // Create a multi-stream destination: both console and file
  const fileDestination = pino.destination({
    dest: logFile,
    sync: false, // async writes for better performance
    mkdir: true,
  })

  return pino(
    {
      level: process.env.LOG_LEVEL || LogLevel.INFO,
      formatters: {
        level: (label) => {
          return { level: label }
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    // Multi-stream: console + file
    pino.multistream([
      { stream: pino.destination(1) }, // console
      { stream: fileDestination },      // file
    ])
  )
}

// Default logger instance
let loggerInstance: ReturnType<typeof createLogger> | null = null

export function getLogger(service?: string): ReturnType<typeof createLogger> {
  if (!loggerInstance) {
    // Always use 'claude-worker' as the log filename
    loggerInstance = createLogger('claude-worker')
  }
  return loggerInstance
}

// Log helper with context
export function logWithContext(
  logger: ReturnType<typeof createLogger>,
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  const config = getConfig()
  logger[level]({
    service: 'claude-worker',
    role: config.WORKER_ROLE,
    namespace: config.SESSION_NAMESPACE,
    ...context,
  }, message)
}
