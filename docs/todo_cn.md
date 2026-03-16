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

- [x] 1.1 创建 `claude-worker/` 源代码目录结构（根目录）
- [x] 1.2 创建 `slack-bridge/` 源代码目录结构（根目录）
- [x] 1.3 创建 `docker/` 目录（包含 compose.yaml 和 volumes）
- [x] 1.4 创建 `volumes/` 目录结构（现位于 docker/volumes）
- [x] 1.5 创建根目录 `.env.example` 配置文件
- [x] 1.6 创建 `docker/compose.yaml` 完整配置

### Phase 1: Claude Worker 基础服务

- [x] 2.1 初始化 Node.js TypeScript 服务 (ExpressJS)
- [x] 2.2 添加健康检查端点 `GET /health`
- [x] 2.3 添加环境配置加载
- [x] 2.4 添加角色感知配置结构
- [x] 2.5 添加内存队列抽象
- [x] 2.6 添加结构化日志 (JSON格式)
- [x] 2.7 添加本地文件日志写入

### Phase 2: 持久化状态层

- [x] 3.1 集成 SQLite 数据库
- [x] 3.2 添加 SQLite schema 迁移支持
- [x] 3.3 定义表结构 (jobs, job_events, sessions, approvals, slack_thread_bindings)
- [x] 3.4 添加 Repository 层
- [x] 3.5 更新 API 读写持久化状态

### Phase 3: Claude SDK 集成

- [x] 4.1 集成 Claude Agent SDK (`@anthropic-ai/sdk`)
- [x] 4.2 实现 SDK 运行器模块
- [x] 4.3 支持 cwd, resume, permissionMode
- [x] 4.4 将 SDK 事件流式写入任务事件存储
- [x] 4.5 持久化 session_id 映射

### Phase 4: 工作空间和Worktree管理

- [x] 5.1 实现 repo 注册表配置（白名单）
- [x] 5.2 实现 repo 路径验证（防止路径穿越）
- [x] 5.3 添加工作空间管理器
- [x] 5.4 实现 worktree 生命周期（创建/清理）
- [x] 5.5 在任务元数据中持久化工作空间路径

### Phase 5: 审批系统

- [x] 6.1 实现审批持久化
- [x] 6.2 添加审批网关模块
- [x] 6.3 将 SDK 工具权限请求接入审批网关
- [x] 6.4 添加审批端点 `POST /approvals/:approval_id`
- [x] 6.5 更新任务状态机 (running -> waiting_approval -> running)
- [x] 6.6 发出审批相关事件

### Phase 6: 事件流 (SSE)

- [x] 7.1 实现 `GET /jobs/:id/events` 为 SSE
- [x] 7.2 流式传输存储的事件和实时事件
- [x] 7.3 定义事件 payload schema
- [x] 7.4 添加序列号用于重放和排序

### Phase 7: 角色隔离的Worker容器

- [x] 8.1 确定 Worker 角色配置模型
- [x] 8.2 创建 compose 服务 (claude-worker-coding, claude-worker-support)
- [x] 8.3 设置角色特定的环境值
- [x] 8.4 挂载角色特定的卷
- [x] 8.5 按角色限制工具集

### Phase 8: Flowise 集成

- [x] 9.1 在 Docker Compose 中启动 Flowise
- [x] 9.2 配置 Flowise 数据库持久化
- [x] 9.3 创建 ClaudeWorkerTool Flowise Tool 节点
- [x] 9.4 构建第一个 Agentflow
- [x] 9.5 将流程定义导出到版本控制文件

### Phase 9: Slack Bridge

- [x] 10.1 创建 Slack 桥接服务 (Bolt for Express)
- [x] 10.2 使用 Socket Mode 连接 Slack
- [x] 10.3 实现线程绑定存储
- [x] 10.4 添加 Flowise 客户端模块
- [x] 10.5 添加 Flowise 流式输出的 SSE 消费者
- [x] 10.6 添加 Slack 消息更新 (速率限制)
- [x] 10.7 添加审批按钮操作

### Phase 10: 技能、政策和工具契约

- [x] 11.1 创建 `skills/coding/` 文档
- [x] 11.2 创建 `skills/support/` 文档
- [x] 11.3 定义工具的政策注册表
- [x] 11.4 实现工具名称映射验证
- [x] 11.5 为每个工具添加结构化结果契约

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
| Phase 0 | ✅ 完成 | 2024-03-16 |
| Phase 1 | ✅ 完成 | 2024-03-16 |
| Phase 2 | ✅ 完成 | 2024-03-16 |
| Phase 3 | ✅ 完成 | 2024-03-16 |
| Phase 4 | ✅ 完成 | 2024-03-16 |
| Phase 5 | ✅ 完成 | 2024-03-16 |
| Phase 6 | ✅ 完成 | 2024-03-16 |
| Phase 7 | ✅ 完成 | 2024-03-16 |
| Phase 8 | ✅ 完成 | 2024-03-16 |
| Phase 9 | ✅ 完成 | 2024-03-16 |
| Phase 10 | ✅ 完成 | 2024-03-16 |
| Phase 11 | ⏳ 待开始 | - |
| Phase 12 | ⏳ 待开始 | - |

---

## 快速链接

- [实施计划](./plan_cn.md)
- [PRD 文档](./prd_v1.md)
- [英文实施计划](./implementation-plan-ai-coding.md)
