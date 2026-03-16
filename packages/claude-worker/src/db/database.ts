import Database from 'better-sqlite3'
import { getConfig } from '../config'
import { getLogger } from '../logger'

const logger = getLogger('database')

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (db) {
    return db
  }

  const config = getConfig()
  const dbPath = config.DATABASE_PATH

  logger.info({ database: dbPath }, 'Initializing database')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  initializeSchema(db)

  return db
}

function initializeSchema(database: Database.Database): void {
  logger.info('Initializing database schema')

  // Jobs table
  database.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      input TEXT NOT NULL,
      output TEXT,
      workspace_path TEXT,
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    )
  `)

  // Job events table
  database.exec(`
    CREATE TABLE IF NOT EXISTS job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    )
  `)

  // Sessions table
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      job_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
    )
  `)

  // Approvals table
  database.exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      responded_at TEXT,
      response TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    )
  `)

  // Slack thread bindings table
  database.exec(`
    CREATE TABLE IF NOT EXISTS slack_thread_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      flowise_session_id TEXT NOT NULL,
      worker_role TEXT NOT NULL,
      job_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(channel_id, thread_ts)
    )
  `)

  // Create indexes for better query performance
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_role ON jobs(role);
    CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_sessions_namespace ON sessions(namespace);
    CREATE INDEX IF NOT EXISTS idx_approvals_job_id ON approvals(job_id);
  `)

  logger.info('Database schema initialized')
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
    logger.info('Database closed')
  }
}
