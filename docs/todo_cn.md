# Local Agent OS 项目进度

## 项目概述

在 Mac mini 上构建本地多智能体协作系统：
- Flowise 作为编排层
- Claude Workers 作为执行层
- Slack Bridge 作为 IM 集成层

**当前分支**: `feat/local-agent-os`

---

## 待办事项 (Todo List)

### Phase 0: 仓库初始化

- [ ] 1.1 创建 `packages/claude-worker/` 源代码目录结构
- [ ] 1.2 创建 `packages/slack-bridge/` 源代码目录结构
- [ ] 1.3 创建 `docker/services/` 目录（仅放置 Dockerfile）
- [ ] 1.4 创建 `volumes/` 目录结构
- [ ] 1.5 创建根目录 `.env.example` 配置文件
- [ ] 1.6 创建 `docker/compose.yaml` 草案

### Phase 1: Claude Worker 基础服务

- [ ] 2.1 初始化 Node.js TypeScript 服务 (ExpressJS)
- [ ] 2.2 添加健康检查端点 `GET /health`
- [ ] 2.3 添加环境配置加载
- [ ] 2.4 添加角色感知配置结构
- [ ] 2.5 添加内存队列抽象
- [ ] 2.6 添加结构化日志 (JSON格式)
- [ ] 2.7 添加本地文件日志写入

### Phase 2: 持久化状态层

- [ ] 3.1 集成 SQLite 数据库
- [ ] 3.2 添加 SQLite schema 迁移支持
- [ ] 3.3 定义表结构 (jobs, job_events, sessions, approvals, slack_thread_bindings)
- [ ] 3.4 添加 Repository 层
- [ ] 3.5 更新 API 读写持久化状态

### Phase 3: Claude SDK 集成

- [ ] 4.1 集成 Claude Agent SDK (`@anthropic-ai/sdk`)
- [ ] 4.2 实现 SDK 运行器模块
- [ ] 4.3 支持 cwd, resume, permissionMode
- [ ] 4.4 将 SDK 事件流式写入任务事件存储
- [ ] 4.5 持久化 session_id 映射

### Phase 4: 工作空间和Worktree管理

- [ ] 5.1 实现 repo 注册表配置（白名单）
- [ ] 5.2 实现 repo 路径验证（防止路径穿越）
- [ ] 5.3 添加工作空间管理器
- [ ] 5.4 实现 worktree 生命周期（创建/清理）
- [ ] 5.5 在任务元数据中持久化工作空间路径

### Phase 5: 审批系统

- [ ] 6.1 实现审批持久化
- [ ] 6.2 添加审批网关模块
- [ ] 6.3 将 SDK 工具权限请求接入审批网关
- [ ] 6.4 添加审批端点 `POST /approvals/:approval_id`
- [ ] 6.5 更新任务状态机 (running -> waiting_approval -> running)
- [ ] 6.6 发出审批相关事件

### Phase 6: 事件流 (SSE)

- [ ] 7.1 实现 `GET /jobs/:id/events` 为 SSE
- [ ] 7.2 流式传输存储的事件和实时事件
- [ ] 7.3 定义事件 payload schema
- [ ] 7.4 添加序列号用于重放和排序

### Phase 7: 角色隔离的Worker容器

- [ ] 8.1 确定 Worker 角色配置模型
- [ ] 8.2 创建 compose 服务 (claude-worker-coding, claude-worker-support)
- [ ] 8.3 设置角色特定的环境值
- [ ] 8.4 挂载角色特定的卷
- [ ] 8.5 按角色限制工具集

### Phase 8: Flowise 集成

- [ ] 9.1 在 Docker Compose 中启动 Flowise
- [ ] 9.2 配置 Flowise 数据库持久化
- [ ] 9.3 创建 ClaudeWorkerTool Flowise Tool 节点
- [ ] 9.4 构建第一个 Agentflow
- [ ] 9.5 将流程定义导出到版本控制文件

### Phase 9: Slack Bridge

- [ ] 10.1 创建 Slack 桥接服务 (Bolt for Express)
- [ ] 10.2 使用 Socket Mode 连接 Slack
- [ ] 10.3 实现线程绑定存储
- [ ] 10.4 添加 Flowise 客户端模块
- [ ] 10.5 添加 Flowise 流式输出的 SSE 消费者
- [ ] 10.6 添加 Slack 消息更新 (速率限制)
- [ ] 10.7 添加审批按钮操作

### Phase 10: 技能、政策和工具契约

- [ ] 11.1 创建 `volumes/coding-agent/skills/` 文档
- [ ] 11.2 创建 `volumes/support-agent/skills/` 文档
- [ ] 11.3 定义工具的政策注册表
- [ ] 11.4 实现工具名称映射验证
- [ ] 11.5 为每个工具添加结构化结果契约

### Phase 11: 日志和管理可视化

- [ ] 12.1 标准化文本日志和 JSONL 事件日志
- [ ] 12.2 确保每个任务日志文件创建
- [ ] 12.3 添加 `GET /jobs?status=running` 端点
- [ ] 12.4 添加基础管理 CLI 或脚本

### Phase 12: 强化和冒烟测试

- [ ] 13.1 添加启动检查（环境值、卷挂载、Claude CLI）
- [ ] 13.2 添加冒烟测试脚本
- [ ] 13.3 添加部署运行手册

---

## 完成状态

| Phase | 状态 | 完成日期 |
|-------|------|----------|
| Phase 0 | ⏳ 待开始 | - |
| Phase 1 | ⏳ 待开始 | - |
| Phase 2 | ⏳ 待开始 | - |
| Phase 3 | ⏳ 待开始 | - |
| Phase 4 | ⏳ 待开始 | - |
| Phase 5 | ⏳ 待开始 | - |
| Phase 6 | ⏳ 待开始 | - |
| Phase 7 | ⏳ 待开始 | - |
| Phase 8 | ⏳ 待开始 | - |
| Phase 9 | ⏳ 待开始 | - |
| Phase 10 | ⏳ 待开始 | - |
| Phase 11 | ⏳ 待开始 | - |
| Phase 12 | ⏳ 待开始 | - |

---

## 快速链接

- [实施计划](./plan_cn.md)
- [PRD 文档](./prd_v1.md)
- [英文实施计划](./implementation-plan-ai-coding.md)
