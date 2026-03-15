# Local Agent OS 实施计划

基于 PRD v1 和 implementation-plan-ai-coding.md 整合优化

## Context

根据 PRD v1 文档，需要在Mac mini上构建一个本地多智能体协作系统：
- Flowise 作为编排层
- Claude Workers 作为执行层
- Slack Bridge 作为IM集成层
- 使用SQLite存储
- 本地构建Docker镜像

**关键约束**：
- MVP完整范围：Flowise + Slack Bridge + Coding Worker + Support Worker
- 数据库：SQLite
- Flowise镜像：本地构建（在现有Flowise代码库中开发）

---

## 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                      Docker Compose                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Flowise   │  │Slack Bridge │  │   Claude Worker         │ │
│  │  (本地构建)  │  │Bolt+Express│  │   (Express + Claude)   │ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
│         │                │                      │               │
│         │    HTTP API / SSE                     │               │
│         │◄──────────────┴──────────────────────┘               │
│         │                                                       │
│  ┌──────┴──────┐                                                │
│  │    SQLite    │                                                │
│  │  (数据卷)     │                                                │
│  └─────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 推荐的代码库结构

采用方案 B：源代码在 packages/ 下，docker/ 目录仅保留构建配置

```
Flowise/
  packages/
    server/           # Flowise后端 (已存在)
    components/       # Flowise组件 (已存在)
      nodes/
        tools/
          ClaudeWorkerTool/ # 新增: Claude Worker Tool节点
    claude-worker/   # 新增: Worker服务源代码
      src/
        config/      # 配置管理
        api/         # API路由 (Express)
        jobs/        # 任务管理
        sessions/    # 会话管理
        workspace/   # 工作空间管理
        approvals/   # 审批系统
        logging/     # 日志
        sdk/         # Claude SDK封装
        db/          # SQLite数据库
        repositories/# 数据仓库层
        events/      # 事件流
      package.json
      tsconfig.json
    slack-bridge/    # 新增: Slack桥接服务源代码
      src/
        slack/       # Slack事件处理
        flowise/     # Flowise API客户端
        mapping/     # 会话映射
      package.json
      tsconfig.json
  docker/
    services/        # 仅保留构建配置
      claude-worker/
        Dockerfile
      slack-bridge/
        Dockerfile
    compose.yaml     # Docker Compose配置（volume挂载在compose中定义）
  volumes/           # 持久化数据（通过compose的volumes挂载）
    flowise/        # Flowise 数据库
    coding-agent/   # Coding Agent数据目录
      repos/        # Git仓库持久化克隆
      workspaces/   # Job工作目录
      sessions/     # 会话数据
      logs/         # 日志文件
      skills/       # 技能文档
      worker.db     # Worker SQLite数据库
    support-agent/  # Support Agent数据目录
      docs/         # 支持文档
      sessions/
      logs/
      skills/
```

**目录说明**：

- **repos目录**：永久的Git仓库克隆（原始仓库）
  - 例如 `repos/my-project/` 是完整的git仓库克隆
  - 这是干净的原始代码，不会被直接修改

- **workspaces目录**：每个Job的工作目录（通过Git Worktree创建）
  - 从repos中的仓库创建worktree到workspaces目录
  - 例如job-123会创建: `git worktree add workspaces/job-123 main`
  - **启动worktree的流程**:
    1. 接收任务，指定repo和分支
    2. 从repos中创建worktree到workspaces/job-{id}
    3. Claude在workspaces/job-{id}目录下执行
    4. 任务完成后删除worktree（清理）或保留（调试）
  - **好处**：任务隔离、并行执行、原始仓库安全

- **skills目录**：每个Agent特有的技能文档
  - 放在对应agent的data目录下
  - 例如 `coding-agent/skills/use-worktree.md`

---

## 实施阶段 (12 Phases)

### Phase 0: 仓库初始化

**任务**:  
1. 创建 `packages/claude-worker/` 源代码目录结构
2. 创建 `packages/slack-bridge/` 源代码目录结构
3. 创建 `docker/services/` 目录（仅放置 Dockerfile）
4. 创建 `volumes/` 目录（持久化数据）
5. 创建根目录 `.env.example` 配置文件
6. 创建 `docker/compose.yaml` 草案

**关键文件**:
- `.env.example`
- `docker/compose.yaml`
- `docker/services/claude-worker/Dockerfile`
- `docker/services/slack-bridge/Dockerfile`
- `volumes/coding-agent/`
- `volumes/support-agent/`

---

### Phase 1: Claude Worker 基础服务

**目标**: 构建可复用的Worker服务 (ExpressJS)，可通过配置实例化为不同角色

**技术栈**:
- ExpressJS (HTTP服务器)
- TypeScript

**任务**:
1. 初始化 Node.js TypeScript 服务 (ExpressJS)
2. 添加健康检查端点 `GET /health`
3. 添加环境配置加载
4. 添加角色感知配置结构:
   - `WORKER_ROLE` (coding/support)
   - `SESSION_NAMESPACE`
   - `DATA_ROOT` (包含 repos/, workspaces/, sessions/, logs/, skills/ 等子目录)
   - `MAX_CONCURRENCY`
5. 添加内存队列抽象（用于任务排队和并发控制）
6. 添加结构化日志 (JSON格式)
7. 添加本地文件日志写入 (写入 DATA_ROOT/logs/，通过 volumes 持久化)

**API实现**:
- `GET /health`
- `POST /jobs` (mock job)
- `GET /jobs/:id`
- `GET /jobs/:id/result`

**关键文件**:
- `packages/claude-worker/src/index.ts` (Express入口)
- `packages/claude-worker/src/config.ts`
- `packages/claude-worker/src/logger.ts`
- `packages/claude-worker/src/jobs/JobManager.ts`

**验收标准**:
- Worker可在Docker中构建
- 可创建mock任务并轮询状态

---

### Phase 2: 持久化状态层

**目标**: 持久化任务、会话、审批和事件元数据

**任务**:
1. 选择SQLite (已确定)
2. 添加SQLite schema迁移支持
3. 定义表结构:
   - `jobs` - 任务表
   - `job_events` - 任务事件表
   - `sessions` - 会话表
   - `approvals` - 审批表
   - `slack_thread_bindings` - Slack线程绑定表
4. 添加Repository层
5. 更新API读写持久化状态

**数据持久化位置**:
- **Worker SQLite**: `DATA_ROOT/worker.db` → `./volumes/coding-agent/worker.db`
- **Flowise SQLite**: 通过 volumes 挂载：`./volumes/flowise:/root/.flowise`

**关键文件**:
- `packages/claude-worker/src/db/schema.ts`
- `packages/claude-worker/src/repositories/JobRepository.ts`
- `packages/claude-worker/src/repositories/SessionRepository.ts`

**验收标准**:
- Worker重启不丢失任务/会话元数据（SQLite 数据库文件放在 `DATA_ROOT/worker.db`，通过 volumes 持久化）
- 重启后可查询事件历史

---

### Phase 3: Claude SDK 集成

**目标**: 集成 Claude Agent SDK，使 Worker 能够执行真实的 AI 任务

**任务**:
1. 集成 Claude Agent SDK (`@anthropic-ai/sdk`)
2. 添加 `CLAUDE_CODE_PATH` 配置（可选，本地 Claude CLI 路径）
3. 实现SDK运行器模块
4. 支持:
   - `cwd` - 工作目录
   - `resume` - 会话恢复
   - `permissionMode` - 权限模式
5. 将SDK事件流式写入任务事件存储
6. 将SDK运行时事件转换为内部事件类型
7. 持久化返回的 `session_id` 映射

**重要约束**:
- 不暴露无限制的文件系统访问
- 所有路径必须根据允许的根目录进行验证

**关键文件**:
- `packages/claude-worker/src/sdk/ClaudeRunner.ts`

**验收标准**:
- 可通过 `POST /jobs` 创建真实Claude任务
- 状态和结果端点反映实时执行

---

### Phase 4: 工作空间和Worktree管理

**目标**: 使编码任务安全且可并发

**任务**:
1. **实现repo注册表配置** - 配置允许 Worker 访问的 Git 仓库列表
   - 例如：`{"repos": ["/data/repos/my-project", "/data/repos/other-repo"]}`
   - 作用：限制 Claude 只能访问已配置的仓库，确保安全
2. **实现repo路径验证** - 验证所有文件操作路径是否在允许范围内
   - 作用：防止路径穿越攻击（如 `../../etc/passwd`）
3. **添加工作空间管理器** - 管理每个 Job 的工作目录
   - 功能：
     - 创建 worktree：`git worktree add /data/workspaces/job-{id} {branch}`
     - 清理 worktree：任务完成后删除
     - 保留 worktree：可选，用于调试
4. 添加worktree生命周期:
   - 准备worktree
   - 清理或保留
5. 对于coding worker:
   - 在 `/data/repos` 下保持持久的repo克隆
   - 在 `/data/workspaces/job-{id}` 为每个任务创建worktree
6. 在任务元数据中持久化工作空间路径

**验收标准**:
- 两个编码任务可以针对同一repo运行而不共享可变目录

---

### Phase 5: 审批系统

**目标**: 引入敏感操作的人工审批门控

**任务**:
1. 实现审批持久化
2. 添加审批网关模块
3. 将SDK工具权限请求接入审批网关
4. 添加端点:
   - `POST /approvals/:approval_id`
5. 更新任务状态机:
   - `running -> waiting_approval -> running`
6. 发出审批相关事件

**关键文件**:
- `packages/claude-worker/src/approvals/ApprovalGateway.ts`

**验收标准**:
- Worker在审批时正确暂停
- 批准/拒绝正确恢复或终止执行

---

### Phase 6: 事件流 (SSE)

**目标**: 将Worker执行更新暴露为SSE

**任务**:
1. 实现 `GET /jobs/:id/events` 为SSE
2. 流式传输存储的事件和实时事件
3. 定义事件payload schema
4. 添加序列号用于重放和排序
5. 确保日志也写入磁盘

**关键文件**:
- `packages/claude-worker/src/events/EventStreamer.ts`

**验收标准**:
- 客户端可以订阅运行中任务的实时进度
- 重连时可从持久存储重新读取事件

---

### Phase 7: 角色隔离的Worker容器

**目标**: 从同一基础镜像实例化多个隔离的Worker

**任务**:
1. 确定Worker角色配置模型
2. 创建compose服务:
   - `claude-worker-coding`
   - `claude-worker-support`
3. 设置角色特定的环境值
4. 挂载角色特定的卷
5. 挂载角色特定的技能目录 (skills/)
6. 按角色限制工具集

**验收标准**:
- Support worker无法访问code repo挂载
- Coding worker无法访问support docs挂载

---

### Phase 8: Flowise 集成

**目标**: 使Flowise成为编排层

**任务**:
1. 在Docker Compose中启动Flowise
2. 配置数据库持久化
3. 在Flowise中创建工具:
   - `CreateCodingJob`
   - `GetJobStatus`
   - `GetJobResult`
   - `ApproveJobAction`
4. 构建第一个Agentflow:
   - 创建任务
   - 保存 `job_id`
   - 循环查询状态
   - 根据终端状态分支
5. 将流程定义导出到版本控制文件

**关键文件**:
- `packages/components/nodes/tools/ClaudeWorkerTool/ClaudeWorkerTool.ts`
- `packages/components/nodes/tools/ClaudeWorkerTool/core.ts`

**验收标准**:
- Flowise agentflow可以启动编码任务并返回结果

---

### Phase 9: Slack Bridge

**目标**: 将Slack线程连接到Flowise会话和Worker任务

**技术栈**:
- Slack Bolt Framework (Slack官方JS框架)
- ExpressJS

**任务**:
1. 创建Slack桥接服务 (Bolt for Express)
2. 使用Socket Mode连接Slack
3. 实现线程绑定存储:
   - `channel_id + thread_ts -> flowise_session_id`
4. 添加Flowise客户端模块
5. 添加Flowise流式输出的SSE消费者
6. 添加Slack消息更新 (速率限制的编辑)
7. 添加审批按钮操作
8. 添加Worker状态消息格式化

**关键文件**:
- `packages/slack-bridge/src/index.ts` (Bolt入口)
- `packages/slack-bridge/src/slack/SlackClient.ts`
- `packages/slack-bridge/src/flowise/FlowiseClient.ts`

**验收标准**:
- Slack线程可以触发Flowise flow
- 响应流回同一线程
- Slack的审批操作到达Worker

---

### Phase 10: 技能、政策和工具契约

**目标**: 通过版本控制的角色特定指令稳定行为

**任务**:
1. 创建 `volumes/coding-agent/skills/` 文档:
   - `use-worktree.md`
   - `create-pr.md`
   - `code-review.md`
2. 创建 `volumes/support-agent/skills/` 文档:
   - `answer-customer.md`
   - `escalate-issue.md`
3. 定义工具的政策注册表
4. 实现工具名称映射到允许的角色策略的验证
5. 为每个工具添加结构化结果契约

---

### Phase 11: 日志和管理可视化

**目标**: 使系统日常可用

**任务**:
1. 标准化文本日志和JSONL事件日志
2. 确保每个任务日志文件创建
3. 添加 `GET /jobs?status=running` 端点
4. 添加基础管理CLI或脚本检查任务
5. 文档说明:
   - `docker compose logs -f`
   - 事件端点
   - 日志目录

**验收标准**:
- 工程师可以在不附加调试器的情况下检查失败的任务

---

### Phase 12: 强化和冒烟测试

**目标**: 使部署在Mac mini上可重复

**任务**:
1. 添加启动检查:
   - 缺失的环境值
   - 无效的卷挂载
   - 缺失的Claude CLI
2. 添加冒烟测试脚本:
   - Worker健康测试
   - 创建mock任务
   - 运行简单Claude任务
   - 验证Flowise API
   - 验证Slack桥接连接
3. 添加部署运行手册

**验收标准**:
- 新机器可以以可预测的结果配置

---

## 关键文件清单

| 阶段 | 文件 | 描述 |
|------|------|------|
| Phase 1 | `packages/claude-worker/src/index.ts` | Worker Express入口 |
| Phase 1 | `packages/claude-worker/src/config.ts` | 配置管理 |
| Phase 1 | `packages/claude-worker/src/logger.ts` | 结构化日志 |
| Phase 2 | `packages/claude-worker/src/db/schema.ts` | SQLite schema |
| Phase 2 | `packages/claude-worker/src/repositories/JobRepository.ts` | 任务仓库 |
| Phase 3 | `packages/claude-worker/src/sdk/ClaudeRunner.ts` | Claude SDK封装 |
| Phase 4 | `packages/claude-worker/src/workspace/WorkspaceManager.ts` | Worktree管理 |
| Phase 5 | `packages/claude-worker/src/approvals/ApprovalGateway.ts` | 审批网关 |
| Phase 6 | `packages/claude-worker/src/events/EventStreamer.ts` | SSE事件流 |
| Phase 8 | `packages/components/nodes/tools/ClaudeWorkerTool/ClaudeWorkerTool.ts` | Flowise Tool节点 |
| Phase 8 | `packages/components/nodes/tools/ClaudeWorkerTool/core.ts` | Tool实现 |
| Phase 9 | `packages/slack-bridge/src/index.ts` | Slack Bolt入口 |
| Phase 9 | `packages/slack-bridge/src/slack/SlackClient.ts` | Slack API封装 |
| Phase 9 | `packages/slack-bridge/src/flowise/FlowiseClient.ts` | Flowise API封装 |
| All | `docker/compose.yaml` | 完整部署配置 |

---

## 验证计划

### 验证步骤

1. **Worker服务测试**:
   ```bash
   # 方式1: 在 packages 目录下直接构建（需要 Dockerfile）
   cd packages/claude-worker
   docker build -t claude-worker .

   # 方式2: 使用 docker/services 下的 Dockerfile（指定 context）
   docker build -t claude-worker -f docker/services/claude-worker/Dockerfile packages/claude-worker

   docker run -p 3001:3001 claude-worker
   # 测试API
   curl -X POST http://localhost:3001/jobs -H "Content-Type: application/json" -d '{"prompt": "Hello", "workerType": "coding"}'
   ```

2. **Flowise Tool测试**:
   ```bash
   pnpm build
   pnpm start
   # 在UI中添加ClaudeWorker Tool节点测试
   ```

3. **集成测试**:
   ```bash
   docker compose -f docker/compose.yaml up -d --build
   # 测试完整流程
   ```

### MVP验收标准

1. `docker compose up -d --build` 启动平台
2. Coding Worker可以创建并在隔离工作空间中执行真实Claude任务
3. Support Worker在容器级别与代码仓库隔离
4. Flowise可以创建Worker任务并轮询结果
5. Slack线程可以触发flow并接收流式更新
6. 审批流程端到端工作
7. 失败的任务可以从日志和存储的事件中调试

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| Claude SDK与本地Claude Code CLI集成复杂度 | 先使用官方SDK，验证后再考虑CLI封装 |
| Slack API配额限制 | 实现消息聚合和速率控制 |
| Worker并发管理 | 使用内存队列 + 限制并发数 |
| SQLite多服务共享 | Slack Bridge和Worker使用各自独立的SQLite |
| 路径验证安全性 | 所有文件操作前验证路径在允许范围内 |

---

## 与原计划的改进点

相比原计划，主要改进：

1. **Phase划分更细粒度**: 12个Phase，循序渐进
2. **技术栈明确**: 明确使用ExpressJS + Slack Bolt Framework
3. **目录结构优化**: skills放在对应agent的data目录下
4. **角色隔离设计**: 明确多Worker容器隔离策略
5. **技能/政策系统**: 引入版本控制的指令系统
