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

## Local Agent OS 项目文档

项目文档位于 `docs/` 目录：

| 文件 | 说明 |
|------|------|
| `docs/plan_cn.md` | 完整的实施计划（中文），包含 12 个 Phase 的详细任务 |
| `docs/todo_cn.md` | 项目进度跟踪，包含待办事项列表 |
| `docs/prd_v1.md` | 产品需求文档 |
| `docs/implementation-plan-ai-coding.md` | 英文实施计划参考 |

### 项目目录结构

```
Flowise/
  packages/
    claude-worker/     # Worker 服务源码
    slack-bridge/     # Slack Bridge 源码
  docker/
    services/         # Dockerfile
    compose.yaml      # Docker Compose 配置
  volumes/           # 持久化数据
  docs/              # 项目文档
```

### 使用文档

1. **实施计划** - 查阅 `docs/plan_cn.md` 了解当前 Phase 的任务
2. **进度跟踪** - 更新 `docs/todo_cn.md` 标记完成的任务
3. **查看进度** - 查看 `docs/todo_cn.md` 的完成状态表格

### 快速命令

```bash
# 查看当前 Phase 进度
cat docs/todo_cn.md | grep -A 20 "## 待办事项"

# 构建 Worker 镜像
docker build -t claude-worker -f docker/services/claude-worker/Dockerfile packages/claude-worker
```

## Docker

### 使用本地构建的镜像（推荐开发时使用）

```bash
# 先创建数据目录（用于SQLite持久化）
mkdir -p ~/.flowise

# 启动容器（带数据卷挂载，数据不会丢失）
docker run -d --name flowise -p 3000:3000 -v ~/.flowise:/root/.flowise flowise:latest

# 停止容器
docker stop flowise

# 重新启动（数据会保留）
docker start flowise

# 如果要重新开始，删除容器和镜像
docker rm -f flowise
```

### 使用Docker Compose（官方方式）

```bash
# 从 docker/ 目录
cp .env.example .env
docker compose up -d
# Access at http://localhost:3000
```

### 使用预构建镜像

```bash
docker run -d --name flowise -p 3000:3000 flowiseai/flowise:latest
```
