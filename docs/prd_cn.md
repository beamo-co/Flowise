Mac Mini 本地多 Worker Agent Platform 技术设计文档

1. 文档目标

本文档定义一套部署在单台 Mac mini 上的本地 Agent Platform 方案，用于支撑公司内部可共享、可持续演进的 AI 工作流。系统目标是：
	•	通过 docker compose up 一键启动完整环境。
	•	支持多个隔离的 Claude worker container，不同 worker 具有不同权限边界。
	•	通过 Flowise 实现 agent flow / workflow 编排。
	•	通过自建 Node.js worker service 封装 Claude Code + Claude Agent SDK。
	•	支持 Slack bridge，将 Flowise/worker 的输出流式映射到 Slack thread。
	•	支持长期任务、审批、状态轮询、session 恢复、实时日志和多任务并发。
	•	所有自定义 tools、skills、prompts、flows 均可在本地开发后提交到 Git，由 Mac mini 拉取并构建。

本文档面向后续 AI coding 和工程实现，强调：
	•	先单机落地。
	•	先做可运行、可审计、可恢复。
	•	不追求分布式和云原生复杂度。

⸻

2. 范围与非目标

2.1 范围

本设计覆盖以下能力：
	1.	单机 Docker Compose 部署。
	2.	Flowise 编排层。
	3.	Claude worker 执行层。
	4.	Slack bridge 输入输出层。
	5.	本地持久化（repo、workspace、session、logs、state）。
	6.	多 worker 权限隔离。
	7.	Claude job 的异步执行、轮询、审批、恢复。
	8.	面向以下典型场景：
	•	Coding agent（创建 worktree、修改代码、跑测试、创建 PR、code review）
	•	Support agent（读取 support docs、答复客户、升级工单）
	•	QA / Knowledge agent（知识问答、知识验证、知识沉淀）

2.2 非目标

以下内容不在第一阶段目标内：
	•	Kubernetes / 多机集群。
	•	自动扩缩容。
	•	强一致分布式队列系统。
	•	复杂多租户权限系统。
	•	对外 SaaS 化。
	•	完整 observability 平台（如一开始即接入 Loki/Grafana/OTel 全家桶）。
	•	完全自动 merge 到主分支。

⸻

3. 设计原则

3.1 Workflow-first

系统目标不是“做很多常驻会话的 agent”，而是“做一套可恢复、可审计、可控的工作流系统”。

3.2 编排层与执行层分离
	•	Flowise 负责 workflow / routing / tool orchestration。
	•	Claude worker 负责真实执行 Claude Code 任务。
	•	Slack bridge 负责 IM 适配与交互。

3.3 权限边界先于 Prompt 约束

不能只靠 prompt 告诉 agent “不要做什么”。
必须从：
	•	文件系统挂载
	•	工具暴露
	•	skill 目录
	•	session namespace
	•	配置

这几层强制隔离。

3.4 长任务异步化

长时间运行的任务不通过单个阻塞 HTTP tool 调用来承载，而是通过 job 模式：
	•	创建 job
	•	后台执行
	•	查询状态
	•	查询结果
	•	审批继续

3.5 事件流和状态分离
	•	Flowise stream 用于用户可见的文本输出和流程更新。
	•	Worker event log 用于精细状态和调试。
	•	UI/Slack 不应只依赖某一条流。

3.6 先做单机低并发、再逐步增强

首版目标：
	•	单机可跑
	•	2~4 个并发 worker job
	•	有状态恢复
	•	有日志和审批

⸻

4. 总体架构

4.1 逻辑组件

系统由五个核心组件构成：
	1.	Flowise
	•	负责 agentflows / chatflows
	•	通过 tools 调用外部 worker
	•	存储上层会话与流程状态
	2.	Slack Bridge
	•	对接 Slack Events API / Socket Mode
	•	将 Slack thread 绑定到 Flowise session
	•	读取 Flowise SSE stream
	•	将 worker 状态转换成 Slack 消息/按钮/审批交互
	3.	Claude Worker（多个）
	•	Node.js service
	•	使用 Claude Agent SDK 驱动 Claude Code
	•	每个 worker container 绑定不同权限域
	•	支持 job / session / logging / approval
	4.	State Store
	•	第一版可用 SQLite 或 Postgres（二选一）
	•	保存 jobs / sessions / approvals / mappings / event metadata
	5.	Persistent Volumes
	•	repos
	•	workspaces
	•	docs
	•	skills
	•	sessions
	•	logs

4.2 部署拓扑

建议在 Mac mini 上以 Docker Compose 启动以下服务：
	•	flowise
	•	slack-bridge
	•	claude-worker-coding
	•	claude-worker-support
	•	claude-worker-qa（第二阶段可选）
	•	postgres 或 sqlite（sqlite 可内嵌在 worker/slack bridge volume 中）
	•	redis（可选，用于事件广播/轻队列）

4.3 系统分层

Slack / IM
    ↓
Slack Bridge
    ↓
Flowise Agentflow / Chatflow
    ↓
HTTP Tools
    ↓
Claude Worker Containers
    ↓
Claude Agent SDK
    ↓
Claude Code CLI
    ↓
Repo / Docs / Local Tools / MCP / GitHub / Slack APIs


⸻

5. 服务职责定义

5.1 Flowise

职责
	•	定义 agentflows / chatflows。
	•	接收来自 Slack bridge 的用户输入。
	•	通过 tools 调用不同 worker 的 API。
	•	管理 Flow State。
	•	将用户可见结果通过 SSE 输出给 Slack bridge。

不负责
	•	直接执行 Claude Code。
	•	直接管理 repo workspace。
	•	直接保存精细 worker logs。
	•	直接做权限审批业务逻辑。

设计定位

Flowise 是 orchestration layer，不是 execution engine。

⸻

5.2 Slack Bridge

职责
	•	接收 Slack message、thread reply、button action。
	•	将 Slack thread 映射到 flowise_session_id。
	•	调用 Flowise Prediction API / Agentflow API。
	•	订阅 Flowise 的 SSE stream。
	•	根据事件更新 Slack thread 消息。
	•	处理审批交互，将结果回传给 worker 或 Flowise。
	•	维护 channel_id + thread_ts + flowise_session_id + job_id 映射。

不负责
	•	执行 Claude Code。
	•	保存 repo。
	•	直接路由到具体 repo 工具。

⸻

5.3 Claude Worker

职责
	•	接收 CreateJob 请求。
	•	决定创建新 session 还是 resume 旧 session。
	•	准备 workspace / worktree。
	•	加载 role-specific skills、toolset、policies。
	•	使用 Claude Agent SDK 调用 Claude Code。
	•	记录结构化事件和文本日志。
	•	管理审批请求。
	•	提供查询 job 状态、查询结果、取消任务等 API。

不负责
	•	上层自然语言对话路由。
	•	Slack 消息格式化。
	•	跨 worker 编排。

⸻

5.4 State Store

方案 ：SQLite（最轻）

适合：
	•	单机
	•	初期开发
	•	低并发

方案 B：Postgres（更稳）

适合：
	•	多服务共享状态
	•	审批、session、mapping、logs 元数据集中存储

推荐：如果人力允许，直接使用 Postgres；否则第一版先 SQLite，后续平滑迁移。

⸻

6. 多 Worker 隔离设计

6.1 Worker 分类

建议第一阶段拆成至少两个 worker：
	1.	claude-worker-coding
	2.	claude-worker-support

第二阶段可增加：
	3.	claude-worker-qa

6.2 隔离目标

Coding Worker

可访问：
	•	coding repos
	•	workspaces
	•	git / GitHub / PR tools
	•	coding-specific skills

不可访问：
	•	support docs
	•	support knowledge base
	•	support-specific tools

Support Worker

可访问：
	•	support docs
	•	ticket / CRM / search tools
	•	Slack external support channel tools
	•	support-specific skills

不可访问：
	•	coding repos
	•	worktrees
	•	PR tools
	•	code review tools

6.3 隔离维度

文件系统隔离

不同 worker container 仅挂载自己的 volume：
	•	coding worker：
	•	/data/repos
	•	/data/workspaces
	•	/data/skills/coding
	•	/data/logs/coding
	•	support worker：
	•	/data/support-docs
	•	/data/skills/support
	•	/data/logs/support

工具隔离

不同 worker 只注册自己的 MCP / custom tools。

Skill 隔离

不同 worker 只加载对应 role 的 skill 目录。

Session 隔离

session namespace 带 role 前缀，例如：
	•	coding:repo-a:thread-123
	•	support:customer-acme:thread-456

配置隔离

每个 worker 使用独立的 env/config：
	•	WORKER_ROLE
	•	DATA_ROOT
	•	SKILL_DIR
	•	TOOLSET
	•	ALLOWED_REPO_ROOTS
	•	ALLOWED_DOC_ROOTS
	•	SESSION_NAMESPACE

⸻

7. 本地目录与持久化设计

建议宿主机目录结构如下：

/opt/agent-stack/
  .env
  compose.yaml
  services/
    claude-worker/
    slack-bridge/
  flowise/
    data/
  data/
    coding/
      repos/
      workspaces/
      sessions/
      logs/
      skills/
    support/
      docs/
      sessions/
      logs/
      skills/
    shared/
      db/
      redis/

7.1 Repos
	•	coding worker 将持久 clone 的 repo 保存于 data/coding/repos
	•	长期保留 bare repo 或主 clone
	•	每个 job 通过 worktree 派生独立 workspace

7.2 Workspaces
	•	每个 job 一个独立目录
	•	命名方式：job-{id}
	•	用于防止并发任务互相污染

7.3 Sessions

保存：
	•	业务 session 映射
	•	Claude SDK session id
	•	业务键（repo、thread、tool）

7.4 Logs

日志按 job/session 分文件：
	•	job-123.log
	•	job-123.events.jsonl
	•	session-abc.log

⸻

8. Claude Worker 设计

8.1 Worker 基础镜像策略

建议使用一个通用基础镜像 claude-worker-base：

包含：
	•	Node.js runtime
	•	Claude Agent SDK
	•	Claude Code CLI
	•	通用 worker server 代码
	•	通用 job/session/logging 库

不同 worker 在 compose 中复用同一镜像，通过 env 和 volume 注入不同角色配置。

8.2 Claude Worker API

建议定义以下 API。

8.2.1 创建任务

POST /jobs

请求：

{
  "tool": "create_pr",
  "repo": "repo-a",
  "prompt": "Fix bug in payment webhook handling",
  "session_key": "coding:repo-a:slack-thread-123",
  "resume": true,
  "metadata": {
    "slack_channel": "C123",
    "slack_thread_ts": "171234.0001"
  }
}

返回：

{
  "job_id": "job-123",
  "session_id": "sess-abc",
  "status": "queued"
}

8.2.2 获取状态

GET /jobs/:id

返回：

{
  "job_id": "job-123",
  "status": "running",
  "session_id": "sess-abc",
  "progress_message": "Running tests in worktree...",
  "approval_required": false,
  "result_ready": false
}

8.2.3 获取结果

GET /jobs/:id/result

返回：

{
  "job_id": "job-123",
  "status": "succeeded",
  "summary": "PR created successfully",
  "artifacts": {
    "pr_url": "...",
    "branch": "..."
  }
}

8.2.4 获取事件流

GET /jobs/:id/events

支持：
	•	SSE（优先）
	•	或轮询 JSON

8.2.5 取消任务

POST /jobs/:id/cancel

8.2.6 审批接口

POST /approvals/:approval_id

请求：

{
  "decision": "approve"
}


⸻

8.3 Session 设计

业务 session key

使用稳定业务键：

{worker_role}:{repo_or_domain}:{thread_or_task_id}

Claude session id

由 worker 保存真实 Claude SDK session id。

恢复策略
	•	resume = false：创建新 Claude session
	•	resume = true 且存在可恢复 mapping：使用旧 session

注意事项
	•	恢复 session 用于上下文连续性
	•	UI 历史回放不要完全依赖 Claude session，必须由系统自己保存 event history

⸻

8.4 Claude SDK 调用模型

每个任务执行时：
	1.	解析 role-specific config
	2.	准备 cwd
	3.	设置 permissionMode
	4.	设置 resume（如果有）
	5.	注入对应 skill/plugin/toolset
	6.	流式读取 SDK 事件
	7.	写入 event log
	8.	根据事件更新 job 状态

关键能力
	•	cwd 指定工作目录
	•	resume 续接 session
	•	permissionMode 控制权限
	•	canUseTool 桥接人工审批

⸻

9. Skills / Tools / Policies 设计

9.1 Skill 分类

建议以 markdown 形式管理 skills：

coding skills
	•	use-worktree.md
	•	create-pr.md
	•	code-review.md
	•	test-before-pr.md

support skills
	•	answer-customer.md
	•	escalate-issue.md
	•	use-support-docs.md

qa skills
	•	search-knowledge.md
	•	verify-answer.md
	•	update-knowledge.md

9.2 Tool 分类

coding tools
	•	create_worktree
	•	run_tests
	•	create_pull_request
	•	request_code_review

support tools
	•	search_support_docs
	•	create_ticket
	•	post_internal_alert

shared tools
	•	post_to_slack
	•	fetch_thread_context
	•	store_event_log

9.3 Policy 分类

每个 tool 配一个 policy：
	•	allowed_actions
	•	forbidden_actions
	•	approval_rules
	•	result_contract

例如 create_pr tool policy：
	•	只能在 coding worker 上运行
	•	必须在 worktree 中操作
	•	创建 PR 前必须有测试结果
	•	需要返回 pr_url

⸻

10. Flowise 设计

10.1 Flowise 定位

Flowise 仅负责 orchestration，不直接做长时间任务执行。

10.2 Tool 设计模式

不建议在 Flowise 中做“一个长阻塞 tool 执行完整 Claude 任务”。
推荐采用：

创建型 Tool
	•	CreateCodingJob
	•	CreateSupportJob
	•	CreateQAJob

查询型 Tool
	•	GetJobStatus
	•	GetJobResult

控制型 Tool
	•	ApproveJobAction
	•	RejectJobAction
	•	CancelJob

10.3 Agentflow 轮询模式

在 Flowise Agentflow 中显式构建工作流：
	1.	创建 job
	2.	存储 job_id 到 Flow State
	3.	进入 loop
	4.	周期性查询状态
	5.	根据状态分支：
	•	running → 继续 loop
	•	waiting_approval → Human Input → Approve/Reject
	•	succeeded → 获取结果
	•	failed → 输出错误

设计原因

轮询属于 workflow 逻辑，而不是 LLM 的自由决定。

10.4 Flow State

建议在 Flow State 中维护：
	•	job_id
	•	session_id
	•	current_step
	•	approval_id
	•	result_summary

注意：不要假设完整 $flow.state 会自动暴露到外部 stream，关键状态需要主动回传到 Slack bridge 或状态服务。

⸻

11. Slack Bridge 设计

11.1 为什么需要独立 Slack Bridge

Slack 与 Flowise/worker 的流式接口模型不同，必须有专门 bridge 来：
	•	管理会话绑定
	•	转换流式输出
	•	控制消息更新频率
	•	处理审批按钮与回复

11.2 Slack 会话绑定

建议维护映射表：
	•	slack_channel_id
	•	slack_thread_ts
	•	flowise_session_id
	•	active_job_id
	•	approval_id

绑定规则
	•	同一 Slack thread 使用同一个 flowise_session_id
	•	若 thread 中存在活跃 job，则查询/审批操作优先关联该 job

11.3 Slack 输入处理

普通消息
	•	转发至 Flowise
	•	使用对应 flowise_session_id

审批动作
	•	调用 worker /approvals/:id
	•	或调 Flowise human input 节点

查询状态
	•	调用 worker /jobs/:id
	•	在 thread 中更新状态消息

11.4 Slack 输出处理

建议分两类消息：

主回复消息
	•	用于展示用户可见的 streaming answer
	•	从 Flowise SSE 的 token 聚合而来
	•	每隔 1~2 秒编辑一次，避免频率限制

状态消息
	•	展示 job 状态、审批、测试、PR 等阶段性信息
	•	主要来自 worker 的状态流，而不是只依赖 Flowise token

⸻

12. Streaming / 状态输出设计

12.1 Flowise Stream 作用

Flowise stream 适合承载：
	•	用户可见文本输出
	•	流程执行更新
	•	tool 使用信息
	•	最终结束/错误

12.2 Worker Event Stream 作用

worker 自身必须额外提供事件流，用于承载：
	•	job_created
	•	session_resumed
	•	planning_started
	•	tool_requested
	•	approval_pending
	•	approval_resolved
	•	worktree_created
	•	tests_started
	•	tests_passed
	•	pr_created
	•	job_failed
	•	job_completed

12.3 Slack 展示策略

Slack bridge 合并两类流：
	1.	Flowise SSE
	2.	Worker event stream

并转换成：
	•	文本回复
	•	状态更新
	•	审批按钮

⸻

13. 日志与调试设计

13.1 日志目标

系统必须支持：
	•	实时查看当前任务执行情况
	•	任务失败后可回溯原因
	•	审批链和工具调用可审计

13.2 日志类型

文本日志

适合人阅读：
	•	job 开始/结束
	•	进入哪个 repo
	•	Claude 返回摘要
	•	测试结果
	•	PR URL

JSONL 结构化事件日志

适合程序处理和 UI 展示：
	•	event_type
	•	job_id
	•	session_id
	•	timestamp
	•	payload

13.3 日志存储

每个 worker 将日志写入 role-specific volume：
	•	/data/logs/coding
	•	/data/logs/support

13.4 查看方式

初期
	•	docker compose logs -f
	•	查看本地 log 文件
	•	查询 /jobs/:id/events

后续可选增强
	•	Loki / Grafana
	•	简单 admin UI

⸻

14. 长任务与阻塞问题设计

14.1 问题

Flowise tool 调用如果直接等待完整 Claude 执行结果，会导致：
	•	请求阻塞过久
	•	无法优雅展示中间状态
	•	不便审批
	•	重试/取消困难

14.2 解决方案

采用 job 模式：
	•	创建任务立即返回 job_id
	•	worker 后台执行
	•	Flowise agentflow 轮询查询
	•	Slack bridge 可独立读取状态流

14.3 任务状态机

建议定义统一状态：
	•	queued
	•	running
	•	waiting_approval
	•	succeeded
	•	failed
	•	cancelled

14.4 Flowise 轮询节奏
	•	每轮查询一次 status
	•	如果 running，进入下一轮
	•	设置最大轮询次数和超时条件

⸻

15. 并发设计

15.1 并发目标

同一台 Mac mini 上支持多个 Claude job 并发运行，每个有不同 session id 和独立 workspace。

15.2 并发边界

第一阶段建议控制为：
	•	coding worker：同时 2 个 job
	•	support worker：同时 2~4 个 job

15.3 并发隔离手段

每任务一个独立 workspace

/data/coding/workspaces/job-{id}

每任务一个独立 Claude 进程

不在同一 job 中复用运行中的 Claude 进程。

每任务一个 session id

一个 job 绑定一个 Claude 会话上下文。

不共享正在写的工作目录

禁止多个 coding job 在同一 worktree 里并发运行。

15.4 Job 调度

每个 worker 实现轻量调度器：
	•	job queue
	•	max concurrency
	•	超额任务排队

⸻

16. Worktree / Repo 管理

16.1 目标

让 coding worker 安全并发操作 repo，而不互相污染。

16.2 推荐模式
	•	为每个 repo 保留一个主 clone 或 bare repo
	•	每个 job 创建自己的 worktree
	•	Claude 在 worktree 中执行
	•	job 结束后可清理或保留 worktree

16.3 优势
	•	多任务隔离
	•	易于调试
	•	避免 branch 污染
	•	更适合 session 恢复

⸻

17. 审批设计

17.1 何时需要审批

建议以下场景默认进入审批：
	•	创建 PR
	•	执行高风险 shell 命令
	•	推送远端分支
	•	删除大量文件
	•	修改敏感目录

17.2 审批流程
	1.	Claude SDK 触发 tool request
	2.	worker 将任务状态改为 waiting_approval
	3.	生成 approval_id
	4.	Slack bridge 在 thread 发审批消息
	5.	reviewer 点击 approve / deny
	6.	bridge 调 worker 审批接口
	7.	worker 继续或中断 Claude 执行

17.3 审批持久化

必须保存：
	•	approval_id
	•	job_id
	•	session_id
	•	tool_name
	•	tool_input
	•	status
	•	reviewer
	•	reviewed_at

⸻

18. 安全设计

18.1 最小权限原则
	•	support worker 不挂 coding repo
	•	coding worker 不挂 support docs
	•	每个 worker 仅暴露必要工具
	•	不使用共享“大根目录” volume

18.2 风险操作约束
	•	不允许自动 merge 到主分支
	•	不允许默认 bypassPermissions
	•	危险操作必须审批

18.3 Secrets 管理

使用 .env 注入：
	•	Slack tokens
	•	GitHub tokens
	•	Flowise auth
	•	其他外部服务密钥

生产前建议进一步迁移到更安全的 secret 管理方案，但首版可用 .env。

18.4 网络边界
	•	仅内部网络可访问 worker API
	•	Slack bridge 可访问 Flowise 和 worker
	•	尽量不暴露 worker 端口到外网

⸻

19. 配置管理

19.1 .env 内容建议

建议配置：
	•	FLOWISE_PORT
	•	SLACK_BOT_TOKEN
	•	SLACK_APP_TOKEN
	•	GITHUB_TOKEN_CODING
	•	GITHUB_TOKEN_SUPPORT
	•	CODING_MAX_CONCURRENCY
	•	SUPPORT_MAX_CONCURRENCY
	•	CLAUDE_CODE_PATH
	•	DEFAULT_PERMISSION_MODE_CODING
	•	DEFAULT_PERMISSION_MODE_SUPPORT
	•	POSTGRES_URL
	•	REDIS_URL

19.2 Git 管理内容

提交到 Git 的内容：
	•	compose 文件
	•	worker server 代码
	•	slack bridge 代码
	•	flowise flow definitions（如可导出）
	•	tools 定义
	•	skills 文档
	•	default config templates

不提交：
	•	.env
	•	实际 token
	•	本地 repo 数据
	•	logs
	•	sessions 数据

⸻

20. Docker Compose 设计原则

20.1 Compose 目标

通过单条命令：

docker compose up -d --build

即可：
	•	构建 worker / bridge 镜像
	•	启动所有服务
	•	绑定 volumes
	•	载入配置

20.2 Compose 中每个 worker 单独 service

例如：
	•	claude-worker-coding
	•	claude-worker-support

每个 service 有：
	•	独立 env
	•	独立 volume
	•	独立 container name
	•	可配置资源限制

⸻

21. 开发与发布流程

21.1 本地开发

开发者在本地：
	•	更新 worker server 代码
	•	更新 Slack bridge
	•	更新 Flowise flows
	•	更新 skills / tools
	•	本地 compose 测试

21.2 Git 提交

将代码、skills、flow definitions 提交到 repo。

21.3 Mac mini 部署

在 Mac mini 上：
	1.	拉取最新代码
	2.	配置 .env
	3.	执行 docker compose up -d --build
	4.	检查 health status
	5.	运行 smoke test

⸻

22. 最小可行版本（MVP）

22.1 第一阶段必须实现

服务
	•	Flowise
	•	Slack bridge
	•	coding worker
	•	support worker

功能
	•	Slack thread 映射到 Flowise session
	•	Flowise 调用 CreateJob / GetStatus / GetResult
	•	coding worker 支持：
	•	指定 cwd
	•	创建 worktree
	•	运行 Claude Code
	•	resume session
	•	基本日志
	•	support worker 支持：
	•	读取 docs
	•	回答支持问题
	•	产生内部提醒
	•	审批：
	•	至少支持 PR 创建审批

22.2 第二阶段增强
	•	QA worker
	•	更完整的 knowledge workflow
	•	Web admin page
	•	更强的 observability
	•	更细粒度 policy engine

⸻

23. 风险与权衡

23.1 Flowise 不是完整 worker runtime

因此需要额外的 worker 服务和 job 模式。

23.2 Claude Code CLI 作为 runtime 的可靠性边界
	•	适合单机、低并发、内部系统
	•	不适合直接当作高并发云端推理服务

23.3 Compose 单机的边界
	•	简单
	•	适合首版
	•	后续若并发/可靠性需求提升，可再演进到更强编排层

23.4 多 worker 带来维护成本
	•	优点：安全隔离清晰
	•	代价：service 数量增加

结论：对当前需求而言，安全收益大于维护成本。

⸻

24. 实施建议顺序

Phase 1
	1.	搭建 claude-worker-coding
	2.	支持 POST /jobs + GET /jobs/:id + GET /jobs/:id/result
	3.	支持 worktree + Claude SDK + 基础日志

Phase 2
	1.	接入 Flowise
	2.	在 Agentflow 中配置 CreateJob / GetStatus / GetResult
	3.	跑通 coding workflow

Phase 3
	1.	接入 Slack bridge
	2.	建立 thread ↔ session ↔ job 映射
	3.	支持 Slack thread 输出

Phase 4
	1.	增加 support worker
	2.	做文档隔离和 tools 隔离
	3.	实现支持类 workflow

Phase 5
	1.	审批系统
	2.	完整 event log
	3.	会话恢复与错误恢复

⸻

25. 最终结论

本方案的核心结论如下：
	1.	Flowise 负责编排，不负责执行 Claude Code。
	2.	Claude Code 通过 Node.js worker + Claude Agent SDK 封装为可控执行器。
	3.	长任务必须使用 job 模式，而不是单个阻塞 tool。
	4.	Slack 必须通过独立 bridge server 接入。
	5.	必须使用多个独立 Claude worker container 进行权限隔离。
	6.	repo、docs、skills、tools、sessions、logs 均应按 worker role 隔离。
	7.	单台 Mac mini + Docker Compose 足以支撑第一代内部 agent platform。

这套设计优先满足：
	•	简单可部署
	•	可审计
	•	可恢复
	•	可扩展
	•	权限清晰

并为后续 AI coding 和系统迭代提供稳定基础。