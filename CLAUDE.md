# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Flowise is a visual AI workflow platform for building AI agents with a drag-and-drop interface. It uses LangChain under the hood and provides both a visual UI and API for creating AI applications.

## Current Development Focus (Local Agent OS)

This repository is being extended to build a **local multi-agent collaboration system** on a single machine. Key goals:
- Run multiple agents simultaneously on one Flowise instance
- Create custom tools (e.g., coding agents that invoke cloudcode processes for code changes, PR creation)
- Integrate internal knowledge base for agent queries
- Answer questions from Slack using internal knowledge

**Branch:** `feat/local-agent-os` - All development for this project happens here

## Commonly Used Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run development (hot reload on port 8080)
pnpm dev

# Start production server (port 3000)
pnpm start

# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run single test (specify package and test file)
pnpm --filter flowise test -- handler.test.ts
pnpm --filter flowise-components test -- some.test.ts

# Lint and fix
pnpm lint-fix

# Clean build artifacts
pnpm clean

# Create database migration
pnpm migration:create
```

## Package Structure

This is a monorepo with 5 main packages:

| Package | Description |
|---------|-------------|
| `packages/server` | Node.js Express backend API |
| `packages/components` | LangChain nodes and integrations |
| `packages/ui` | React frontend |
| `packages/agentflow` | Embeddable React flow editor component |
| `packages/api-documentation` | Swagger API docs |

## Architecture

### Server (`packages/server`)
- Express.js REST API
- TypeORM for database (SQLite, PostgreSQL, MySQL supported)
- BullMQ for job queue processing
- Key files:
  - `src/index.ts` - Entry point
  - `src/handler.ts` - Main chatflow execution logic (85KB, core execution)
  - `src/agents.ts` - Agent execution logic
  - `src/utils/buildChatflow.ts` - Flow building utilities

### Components (`packages/components`)
- LangChain node implementations
- Node types in `nodes/` directory:
  - `agents/` - Agent implementations (ReActAgent, ToolAgent, AutoGPT, etc.)
  - `agentflow/` - Visual flow nodes (Agent, Condition, Loop, LLM, Tool)
  - `chains/` - Chain implementations
  - `chatmodels/` - LLM integrations
  - `vectorstores/` - Vector database integrations

### AgentFlow (`packages/agentflow`)
- React component library for embedding the visual flow editor
- Built on ReactFlow
- Domain-driven architecture: `atoms/`, `features/`, `core/`, `infrastructure/`

## Database

Flowise supports multiple databases. Default is SQLite. Configure via `packages/server/.env`:
- `DATABASE_TYPE` - sqlite, postgres, mysql, mariadb
- `DATABASE_PATH` - Path for SQLite
- `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD` - For PostgreSQL/MySQL

## Environment Configuration

Key environment variables in `packages/server/.env`:
- `PORT` - Server port (default 3000)
- `FLOWISE_SECRETKEY` - API authentication
- `DATABASE_TYPE`, `DATABASE_PATH` - Database config
- `REDIS_HOST`, `REDIS_PORT` - For queue processing

## Development Notes

- Uses pnpm workspaces
- Turbo for build orchestration
- Requires Node.js >= 18.15.0, pnpm ^10.26.0
- AgentFlow package is under active development (not production-ready)
- The codebase uses TypeORM with a main `Tool` entity in `packages/server/src/database/entities/Tool.ts`

## Documentation

- Full docs: https://docs.flowiseai.com/
- API docs available at `/api-documentation` when running

## Local Agent OS Documentation

Documentation is located in the `docs/` directory:

| File | Description |
|------|-------------|
| `docs/plan_cn.md` | Complete implementation plan (Chinese), contains detailed tasks for 12 Phases |
| `docs/todo_cn.md` | Project progress tracking with todo list |
| `docs/prd_v1.md` | Product Requirements Document |
| `docs/implementation-plan-ai-coding.md` | English implementation plan reference |

### Project Directory Structure

```
Flowise/                      # Flowise main project
├── packages/                 # Flowise source code
│   ├── server/              # Backend API
│   ├── components/          # Component nodes
│   ├── ui/                 # Frontend UI
│   └── agentflow/          # AgentFlow component
├── claude-worker/           # Claude Worker service (standalone project)
│   ├── docker/
│   │   └── Dockerfile
│   ├── src/
│   │   ├── index.ts        # Entry point
│   │   ├── config.ts       # Configuration
│   │   ├── jobs/          # Job management
│   │   ├── db/            # SQLite database
│   │   ├── sdk/           # Claude SDK integration
│   │   ├── workspace/     # Worktree management
│   │   ├── approvals/     # Approval system
│   │   └── events/       # SSE event streaming
│   └── package.json
├── slack-bridge/            # Slack Bridge service (standalone project)
│   ├── docker/
│   │   └── Dockerfile
│   ├── src/
│   │   ├── index.ts        # Entry point
│   │   ├── slack/          # Slack API
│   │   └── flowise/       # Flowise client
│   └── package.json
├── docker/
│   ├── compose.yaml        # Docker Compose configuration
│   └── volumes/           # Persistent data volumes
│       ├── flowise/       # Flowise data
│       ├── coding-agent/  # Coding Worker data
│       └── support-agent/ # Support Worker data
├── skills/                 # Role-specific skill documents
│   ├── coding/            # Coding Worker skills
│   └── support/           # Support Worker skills
└── docs/                  # Project documentation
```

### Usage

1. **Implementation Plan** - Check `docs/plan_cn.md` for current Phase tasks
2. **Progress Tracking** - Update `docs/todo_cn.md` to mark completed tasks
3. **View Progress** - Check the completion status table in `docs/todo_cn.md`

### Docker Build Commands

```bash
# Build Flowise local image (from project root)
docker build -t flowise:local .

# Build Claude Worker image
docker build -t claude-worker:test -f claude-worker/docker/Dockerfile claude-worker

# Build Slack Bridge image
docker build -t slack-bridge:test -f slack-bridge/docker/Dockerfile slack-bridge
```

### Environment Setup

Before running Claude Worker, copy `.env.example` to `.env` and configure:

```bash
cd docker
cp .env.example .env

# Edit .env and add your Anthropic credentials:
# ANTHROPIC_AUTH_TOKEN=your-token
# ANTHROPIC_BASE_URL=https://api.anthropic.com (or custom endpoint)
```

### Docker Compose Commands

```bash
# Start all services (from docker directory)
cd docker
docker compose up -d --build   # Build before starting (if code changed)
# Or (if images already built)
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down
```

### Quick Commands

```bash
# View current Phase progress
cat docs/todo_cn.md | grep -A 20 "## 待办事项"
```

## Docker

### Local Agent OS Startup

```bash
# Enter docker directory
cd docker

# Option 1: Build and start all services (recommended)
# First build Flowise, then start all services
docker build -t flowise:local ..
docker compose up -d --build

# Option 2: Start without building (when images exist)
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down

# Rebuild and start (with cache)
docker compose up -d

# Rebuild (without cache)
docker compose build --no-cache
docker compose up -d
```

### Service Ports

| Service | Port | Description |
|---------|------|-------------|
| Flowise | 3000 | Orchestration layer |
| Claude Worker (Coding) | 3001 | Coding Worker |
| Claude Worker (Support) | 3003 | Support Worker |
| Slack Bridge | 3002 | IM Integration |

### Data Volumes

Data is stored in `docker/volumes/`:
- `flowise/` - Flowise database and files
- `coding-agent/` - Coding Worker data (repos, workspaces, sessions)
- `support-agent/` - Support Worker data
