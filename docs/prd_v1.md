# Mac Mini Local Multi-Worker Agent Platform Technical Design

## 1. Document Objective

This document defines a local Agent Platform architecture deployed on a single Mac mini to support internal, shareable, and continuously evolving AI workflows.

The system goals are:

- Bring up the full environment with a single `docker compose up`.
- Support multiple isolated Claude worker containers, each with its own permission boundary.
- Use Flowise for agent flow / workflow orchestration.
- Use a self-hosted Node.js worker service to wrap Claude Code + Claude Agent SDK.
- Support a Slack bridge that maps Flowise/worker streaming output to Slack threads.
- Support long-running tasks, approvals, status polling, session recovery, real-time logs, and concurrent execution.
- Keep all customized tools, skills, prompts, and flows under version control so they can be developed locally, committed to Git, and built on the Mac mini.

This document is intended to guide AI-assisted implementation and engineering work. It emphasizes:

- Start with a single machine.
- Prioritize operability, auditability, and recoverability.
- Avoid unnecessary distributed or cloud-native complexity in the first version.

---

## 2. Scope and Non-Goals

### 2.1 Scope

This design covers the following capabilities:

1. Single-machine Docker Compose deployment.
2. Flowise orchestration layer.
3. Claude worker execution layer.
4. Slack bridge input/output layer.
5. Local persistence for repos, workspaces, sessions, logs, and state.
6. Permission isolation across multiple workers.
7. Asynchronous Claude jobs with polling, approval, and recovery.
8. The following representative scenarios:
   - Coding agent (create worktree, modify code, run tests, create PRs, perform code review)
   - Support agent (read support docs, answer customers, escalate tickets)
   - QA / knowledge agent (knowledge Q&A, verification, and knowledge harvesting)

### 2.2 Non-Goals

The following are explicitly out of scope for phase one:

- Kubernetes or multi-machine clusters.
- Autoscaling.
- Strongly consistent distributed queueing systems.
- Advanced multi-tenant authorization systems.
- External SaaS productization.
- Full observability stack from day one (for example Loki/Grafana/OTel end-to-end).
- Fully automatic merge to the main branch.

---

## 3. Design Principles

### 3.1 Workflow-first

The goal is not to create many long-lived autonomous agents. The goal is to build a recoverable, auditable, and controllable workflow system.

### 3.2 Separation of orchestration and execution

- Flowise is responsible for workflow orchestration and routing.
- Claude workers are responsible for actual Claude Code execution.
- Slack bridge is responsible for IM integration.

### 3.3 Permission boundaries before prompt restrictions

The system must not rely only on prompts saying “do not do X.”
Real isolation must be enforced through:

- Filesystem mounts
- Tool exposure
- Skill directories
- Session namespaces
- Configuration

### 3.4 Long-running tasks must be asynchronous

Long-running tasks should not be carried by one blocking HTTP tool call. They should use a `job` model:

- Create a job
- Execute in the background
- Query status
- Query result
- Approve and continue when needed

### 3.5 Separate event streaming from state

- Flowise stream is for user-visible text output and workflow updates.
- Worker event logs are for detailed status and debugging.
- UI and Slack should not depend on only one stream.

### 3.6 Start with low-concurrency single-machine operation

First-version target:

- Runs on a single machine
- 2 to 4 concurrent worker jobs
- Session recovery support
- Logging and approval support

---

## 4. Overall Architecture

### 4.1 Logical Components

The system consists of five core components:

1. **Flowise**
   - Hosts agentflows / chatflows
   - Calls external workers through tools
   - Stores top-level conversation and flow state

2. **Slack Bridge**
   - Connects to Slack Events API / Socket Mode
   - Binds Slack threads to Flowise sessions
   - Reads Flowise SSE streams
   - Converts worker states into Slack messages, buttons, and approval interactions

3. **Claude Workers (multiple)**
   - Node.js services
   - Use Claude Agent SDK to drive Claude Code
   - Each worker container is tied to a distinct permission domain
   - Support jobs, sessions, logging, and approvals

4. **State Store**
   - SQLite or Postgres in the first version
   - Stores jobs, sessions, approvals, mappings, and event metadata

5. **Persistent Volumes**
   - Repos
   - Workspaces
   - Docs
   - Skills
   - Sessions
   - Logs

### 4.2 Deployment Topology

The recommended Docker Compose deployment on the Mac mini includes:

- `flowise`
- `slack-bridge`
- `claude-worker-coding`
- `claude-worker-support`
- `claude-worker-qa` (optional in phase two)
- `postgres` or `sqlite` (SQLite may be embedded in worker/bridge volumes)
- `redis` (optional, for event broadcasting / light queueing)

### 4.3 Layered Architecture

```text
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
```

---

## 5. Service Responsibilities

## 5.1 Flowise

### Responsibilities

- Define agentflows / chatflows.
- Receive user input from Slack bridge.
- Call worker APIs through tools.
- Manage Flow State.
- Stream user-visible results back through SSE.

### Not responsible for

- Executing Claude Code directly.
- Managing repo workspaces directly.
- Storing detailed worker logs directly.
- Owning approval business logic directly.

### Design Position

Flowise is the orchestration layer, not the execution engine.

---

## 5.2 Slack Bridge

### Responsibilities

- Receive Slack messages, thread replies, and button actions.
- Map Slack threads to `flowise_session_id`.
- Call Flowise Prediction API / Agentflow API.
- Subscribe to Flowise SSE streams.
- Update Slack thread messages based on events.
- Handle approval interactions and relay them to workers or Flowise.
- Maintain `channel_id + thread_ts + flowise_session_id + job_id` mappings.

### Not responsible for

- Executing Claude Code.
- Storing repos.
- Routing to repo-specific tools directly.

---

## 5.3 Claude Worker

### Responsibilities

- Receive `CreateJob` requests.
- Decide whether to create a new session or resume an existing one.
- Prepare workspace / worktree.
- Load role-specific skills, toolsets, and policies.
- Use Claude Agent SDK to call Claude Code.
- Record structured events and text logs.
- Manage approval requests.
- Provide APIs to query job status, query results, and cancel tasks.

### Not responsible for

- Top-level natural-language routing.
- Slack message formatting.
- Cross-worker orchestration.

---

## 5.4 State Store

Two first-version options are recommended:

### Option A: SQLite (lightest)

Suitable for:
- Single machine
- Early development
- Low concurrency

### Option B: Postgres (more robust)

Suitable for:
- Shared state across multiple services
- Centralized storage of approvals, sessions, mappings, and event metadata

Recommendation: if engineering capacity allows, use Postgres directly. Otherwise start with SQLite and migrate later.

---

## 6. Multi-Worker Isolation Design

## 6.1 Worker Types

At minimum, phase one should split into two workers:

1. `claude-worker-coding`
2. `claude-worker-support`

Phase two can add:

3. `claude-worker-qa`

## 6.2 Isolation Goals

### Coding Worker

May access:
- Coding repositories
- Workspaces
- Git / GitHub / PR tools
- Coding-specific skills

Must not access:
- Support docs
- Support knowledge base
- Support-specific tools

### Support Worker

May access:
- Support docs
- Ticket / CRM / search tools
- Slack external support channel tools
- Support-specific skills

Must not access:
- Coding repositories
- Worktrees
- PR tools
- Code review tools

## 6.3 Isolation Dimensions

### Filesystem isolation

Each worker container mounts only its own volumes:

- Coding worker:
  - `/data/repos`
  - `/data/workspaces`
  - `/data/skills/coding`
  - `/data/logs/coding`

- Support worker:
  - `/data/support-docs`
  - `/data/skills/support`
  - `/data/logs/support`

### Tool isolation

Each worker registers only its own MCP / custom tools.

### Skill isolation

Each worker loads only the corresponding role-specific skill directory.

### Session isolation

Session namespace includes the role prefix, for example:

- `coding:repo-a:thread-123`
- `support:customer-acme:thread-456`

### Configuration isolation

Each worker uses its own env/config:

- `WORKER_ROLE`
- `DATA_ROOT`
- `SKILL_DIR`
- `TOOLSET`
- `ALLOWED_REPO_ROOTS`
- `ALLOWED_DOC_ROOTS`
- `SESSION_NAMESPACE`

---

## 7. Local Directory and Persistence Design

Recommended host layout:

```text
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
```

### 7.1 Repos

- Coding worker stores long-lived cloned repos under `data/coding/repos`
- Keep either a bare repo or a primary clone
- Each job derives an isolated workspace via worktree

### 7.2 Workspaces

- One directory per job
- Naming convention: `job-{id}`
- Prevents cross-task contamination during concurrent execution

### 7.3 Sessions

Stores:
- Business session mappings
- Claude SDK session IDs
- Business keys (repo, thread, tool)

### 7.4 Logs

Logs are stored per job / per session:

- `job-123.log`
- `job-123.events.jsonl`
- `session-abc.log`

---

## 8. Claude Worker Design

## 8.1 Base Image Strategy

Use one common image `claude-worker-base` containing:

- Node.js runtime
- Claude Agent SDK
- Claude Code CLI
- Shared worker server code
- Shared job/session/logging libraries

Different workers reuse the same image in Compose but inject different roles through env and volumes.

## 8.2 Claude Worker API

Recommended APIs:

### 8.2.1 Create Job

`POST /jobs`

Request:

```json
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
```

Response:

```json
{
  "job_id": "job-123",
  "session_id": "sess-abc",
  "status": "queued"
}
```

### 8.2.2 Get Status

`GET /jobs/:id`

Response:

```json
{
  "job_id": "job-123",
  "status": "running",
  "session_id": "sess-abc",
  "progress_message": "Running tests in worktree...",
  "approval_required": false,
  "result_ready": false
}
```

### 8.2.3 Get Result

`GET /jobs/:id/result`

Response:

```json
{
  "job_id": "job-123",
  "status": "succeeded",
  "summary": "PR created successfully",
  "artifacts": {
    "pr_url": "...",
    "branch": "..."
  }
}
```

### 8.2.4 Get Event Stream

`GET /jobs/:id/events`

Should support:
- SSE preferably
- or JSON polling

### 8.2.5 Cancel Job

`POST /jobs/:id/cancel`

### 8.2.6 Approval Endpoint

`POST /approvals/:approval_id`

Request:

```json
{
  "decision": "approve"
}
```

---

## 8.3 Session Design

### Business session key

Use a stable business key:

`{worker_role}:{repo_or_domain}:{thread_or_task_id}`

### Claude session ID

The worker stores the actual Claude SDK session ID.

### Resume strategy

- `resume = false`: create a new Claude session
- `resume = true` and a recoverable mapping exists: reuse the old session

### Important note

- Session recovery provides conversational continuity
- UI history playback must not rely solely on Claude session state; the system must persist its own event history

---

## 8.4 Claude SDK Invocation Model

For each task:

1. Resolve role-specific configuration
2. Prepare `cwd`
3. Set `permissionMode`
4. Set `resume` when applicable
5. Inject the corresponding skills / plugins / toolset
6. Stream SDK events
7. Write event logs
8. Update job state based on events

### Key capabilities

- `cwd` for working directory
- `resume` for session continuation
- `permissionMode` for permission control
- `canUseTool` to bridge human approval

---

## 9. Skills / Tools / Policies Design

## 9.1 Skill Categories

Manage skills as markdown files.

### Coding skills

- `use-worktree.md`
- `create-pr.md`
- `code-review.md`
- `test-before-pr.md`

### Support skills

- `answer-customer.md`
- `escalate-issue.md`
- `use-support-docs.md`

### QA skills

- `search-knowledge.md`
- `verify-answer.md`
- `update-knowledge.md`

## 9.2 Tool Categories

### Coding tools

- `create_worktree`
- `run_tests`
- `create_pull_request`
- `request_code_review`

### Support tools

- `search_support_docs`
- `create_ticket`
- `post_internal_alert`

### Shared tools

- `post_to_slack`
- `fetch_thread_context`
- `store_event_log`

## 9.3 Policy Categories

Each tool should have a policy defining:

- `allowed_actions`
- `forbidden_actions`
- `approval_rules`
- `result_contract`

Example policy for `create_pr`:

- Only executable on the coding worker
- Must operate inside a worktree
- Must have test results before PR creation
- Must return `pr_url`

---

## 10. Flowise Design

## 10.1 Flowise Positioning

Flowise is only responsible for orchestration, not for long-running Claude execution.

## 10.2 Tool Design Pattern

Do not expose one long blocking Claude task as a single Flowise tool.
Use:

### Creation Tools

- `CreateCodingJob`
- `CreateSupportJob`
- `CreateQAJob`

### Query Tools

- `GetJobStatus`
- `GetJobResult`

### Control Tools

- `ApproveJobAction`
- `RejectJobAction`
- `CancelJob`

## 10.3 Agentflow Polling Pattern

Build an explicit Agentflow:

1. Create job
2. Store `job_id` in Flow State
3. Enter loop
4. Periodically query status
5. Branch by status:
   - `running` → continue loop
   - `waiting_approval` → Human Input → Approve/Reject
   - `succeeded` → fetch result
   - `failed` → surface error

### Rationale

Polling is workflow logic, not LLM free-form reasoning.

## 10.4 Flow State

Recommended Flow State fields:

- `job_id`
- `session_id`
- `current_step`
- `approval_id`
- `result_summary`

Do not assume complete `$flow.state` will automatically be exposed to external streams. Important state should be explicitly pushed to Slack bridge or a dedicated status service.

---

## 11. Slack Bridge Design

## 11.1 Why a dedicated Slack Bridge is required

Slack and Flowise/worker streaming interfaces do not match 1:1. A dedicated bridge is needed to:

- Manage session bindings
- Translate streaming output
- Control message update rate
- Handle buttons and follow-up input

## 11.2 Slack session binding

Maintain a mapping table for:

- `slack_channel_id`
- `slack_thread_ts`
- `flowise_session_id`
- `active_job_id`
- `approval_id`

### Binding rules

- The same Slack thread should reuse the same `flowise_session_id`
- If an active job exists in the thread, status/approval operations should preferentially attach to that job

## 11.3 Slack input handling

### Normal messages

- Forward to Flowise
- Use the mapped `flowise_session_id`

### Approval actions

- Call worker `/approvals/:id`
- Or send human input to Flowise

### Status requests

- Call worker `/jobs/:id`
- Update status message in the Slack thread

## 11.4 Slack output handling

Use two message categories:

### Main reply message

- Displays streaming user-visible answer
- Aggregated from Flowise SSE `token` events
- Updated every 1 to 2 seconds to avoid Slack rate limits

### Status message

- Displays job status, approval, tests, PR creation, and other milestones
- Primarily sourced from worker status events, not only Flowise text tokens

---

## 12. Streaming and Status Output Design

## 12.1 Purpose of Flowise Stream

Flowise stream is best suited for:

- User-visible text output
- Workflow execution updates
- Tool usage information
- Final completion / error

## 12.2 Purpose of Worker Event Stream

Workers must expose their own event stream for:

- `job_created`
- `session_resumed`
- `planning_started`
- `tool_requested`
- `approval_pending`
- `approval_resolved`
- `worktree_created`
- `tests_started`
- `tests_passed`
- `pr_created`
- `job_failed`
- `job_completed`

## 12.3 Slack Display Strategy

Slack bridge merges two streams:

1. Flowise SSE
2. Worker event stream

And converts them into:

- Text replies
- Status updates
- Approval buttons

---

## 13. Logging and Debugging Design

## 13.1 Logging Goals

The system must support:

- Real-time visibility into active tasks
- Post-failure root cause analysis
- Auditable approval and tool call trails

## 13.2 Log Types

### Text logs

Human-readable logs:

- Job start/end
- Which repo was entered
- Claude output summaries
- Test results
- PR URL

### JSONL structured event logs

Machine-friendly logs:

- `event_type`
- `job_id`
- `session_id`
- `timestamp`
- `payload`

## 13.3 Log Storage

Each worker writes logs to its own role-specific volume:

- `/data/logs/coding`
- `/data/logs/support`

## 13.4 How to view logs

### Early stage

- `docker compose logs -f`
- Inspect local log files
- Query `/jobs/:id/events`

### Later optional enhancements

- Loki / Grafana
- Lightweight admin UI

---

## 14. Long-Running Tasks and Blocking Design

## 14.1 Problem

If a Flowise tool waits for full Claude execution synchronously, it causes:

- Long blocking requests
- Poor visibility into intermediate status
- Hard approvals
- Difficult retries/cancellation

## 14.2 Solution

Use a `job` model:

- Task creation returns `job_id` immediately
- Worker executes in the background
- Flowise agentflow polls status
- Slack bridge can independently read status streams

## 14.3 Task state machine

Recommended states:

- `queued`
- `running`
- `waiting_approval`
- `succeeded`
- `failed`
- `cancelled`

## 14.4 Flowise polling cadence

- Query status once per loop
- If `running`, continue the loop
- Set maximum loop count and timeout conditions

---

## 15. Concurrency Design

## 15.1 Concurrency Goal

Support multiple concurrent Claude jobs on one Mac mini, each with its own session ID and isolated workspace.

## 15.2 Concurrency Limits

Recommended phase-one limits:

- Coding worker: 2 concurrent jobs
- Support worker: 2 to 4 concurrent jobs

## 15.3 Isolation for concurrency

### One workspace per task

`/data/coding/workspaces/job-{id}`

### One Claude process per task

Do not reuse one in-flight Claude process across unrelated jobs.

### One session per task

Each job owns its own Claude conversational context.

### Never share mutable working directories

No concurrent coding jobs should run inside the same worktree.

## 15.4 Job scheduling

Each worker should implement a lightweight scheduler:

- job queue
- max concurrency
- excess tasks wait in queue

---

## 16. Worktree and Repo Management

## 16.1 Goal

Allow coding workers to operate safely on repositories with concurrent task isolation.

## 16.2 Recommended Pattern

- Keep one primary clone or bare repo per repository
- Create one worktree per job
- Claude executes inside the job-specific worktree
- Worktree may be cleaned up or retained after completion

## 16.3 Benefits

- Better multi-task isolation
- Easier debugging
- Reduced branch contamination
- Better support for session recovery

---

## 17. Approval Design

## 17.1 When approval is required

The following actions should require approval by default:

- Creating a PR
- Running high-risk shell commands
- Pushing remote branches
- Deleting many files
- Modifying sensitive directories

## 17.2 Approval flow

1. Claude SDK triggers a tool request
2. Worker changes task state to `waiting_approval`
3. Worker generates `approval_id`
4. Slack bridge posts an approval message in the thread
5. Reviewer clicks approve / deny
6. Bridge calls worker approval API
7. Worker continues or aborts Claude execution

## 17.3 Approval persistence

Store at least:

- `approval_id`
- `job_id`
- `session_id`
- `tool_name`
- `tool_input`
- `status`
- `reviewer`
- `reviewed_at`

---

## 18. Security Design

## 18.1 Principle of least privilege

- Support workers must not mount coding repos
- Coding workers must not mount support docs
- Each worker exposes only the necessary tools
- Avoid one shared root volume mounted to all workers

## 18.2 High-risk action constraints

- Do not allow automatic merge to main
- Do not default to `bypassPermissions`
- Require approval for dangerous actions

## 18.3 Secret management

Use `.env` for the first version to inject:

- Slack tokens
- GitHub tokens
- Flowise auth
- Other service credentials

For later hardening, migrate to stronger secret management. `.env` is acceptable for the first version.

## 18.4 Network boundaries

- Only internal network should access worker APIs
- Slack bridge may access Flowise and workers
- Worker ports should not be exposed publicly unless required

---

## 19. Configuration Management

## 19.1 Recommended `.env` fields

Suggested configuration values:

- `FLOWISE_PORT`
- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `GITHUB_TOKEN_CODING`
- `GITHUB_TOKEN_SUPPORT`
- `CODING_MAX_CONCURRENCY`
- `SUPPORT_MAX_CONCURRENCY`
- `CLAUDE_CODE_PATH`
- `DEFAULT_PERMISSION_MODE_CODING`
- `DEFAULT_PERMISSION_MODE_SUPPORT`
- `POSTGRES_URL`
- `REDIS_URL`

## 19.2 What belongs in Git

Commit the following to Git:

- Compose files
- Worker server code
- Slack bridge code
- Flowise flow definitions (when exportable)
- Tool definitions
- Skill documents
- Default config templates

Do not commit:

- `.env`
- Real tokens or secrets
- Local repo data
- Logs
- Session data

---

## 20. Docker Compose Design Principles

## 20.1 Compose objective

The system should come up with:

```bash
docker compose up -d --build
```

This should:

- Build worker and bridge images
- Start all services
- Bind volumes
- Load configuration

## 20.2 One service per worker role

For example:

- `claude-worker-coding`
- `claude-worker-support`

Each service should have:

- Dedicated env
- Dedicated volume mounts
- Distinct container name
- Optional resource limits

---

## 21. Development and Release Workflow

## 21.1 Local development

Developers locally update:

- Worker server code
- Slack bridge
- Flowise flows
- Skills and tools
- Test using local compose

## 21.2 Git commit

Commit code, skills, and flow definitions to the repository.

## 21.3 Mac mini deployment

On the Mac mini:

1. Pull latest code
2. Configure `.env`
3. Run `docker compose up -d --build`
4. Check service health
5. Run smoke tests

---

## 22. Minimum Viable Version (MVP)

## 22.1 What phase one must include

### Services

- Flowise
- Slack bridge
- Coding worker
- Support worker

### Features

- Slack thread mapped to Flowise session
- Flowise calls `CreateJob / GetStatus / GetResult`
- Coding worker supports:
  - explicit `cwd`
  - worktree creation
  - Claude execution
  - session resume
  - basic logs
- Support worker supports:
  - doc reading
  - support answers
  - internal escalation
- Approval support:
  - at least PR creation approval

## 22.2 Phase two enhancements

- QA worker
- richer knowledge workflows
- web admin page
- stronger observability
- finer-grained policy engine

---

## 23. Risks and Trade-offs

## 23.1 Flowise is not a complete worker runtime

Therefore a dedicated worker service and job model are necessary.

## 23.2 Reliability boundary of Claude Code CLI as runtime

- Suitable for single-machine, low-concurrency internal systems
- Not suitable as a high-concurrency cloud inference backend

## 23.3 Limits of Compose on one machine

- Simple and effective
- Appropriate for the first version
- Can evolve later if concurrency and reliability requirements increase

## 23.4 Maintenance cost of multiple workers

- Benefit: clear security isolation
- Cost: more services to maintain

Conclusion: for current needs, the security benefit outweighs the maintenance overhead.

---

## 24. Recommended Implementation Order

### Phase 1

1. Build `claude-worker-coding`
2. Support `POST /jobs`, `GET /jobs/:id`, and `GET /jobs/:id/result`
3. Support worktree + Claude SDK + basic logging

### Phase 2

1. Integrate Flowise
2. Configure `CreateJob / GetStatus / GetResult` in Agentflow
3. Make the coding workflow run end-to-end

### Phase 3

1. Integrate Slack bridge
2. Build thread ↔ session ↔ job mappings
3. Support Slack thread output

### Phase 4

1. Add support worker
2. Implement doc and tool isolation
3. Build support-specific workflows

### Phase 5

1. Add approval system
2. Add complete event logging
3. Add session recovery and failure recovery

---

## 25. Final Conclusion

The core conclusions of this design are:

1. **Flowise is responsible for orchestration, not direct Claude Code execution.**
2. **Claude Code is wrapped as a controllable execution layer via Node.js workers and Claude Agent SDK.**
3. **Long-running tasks must use a job model rather than a single blocking tool call.**
4. **Slack must be integrated through a dedicated bridge service.**
5. **Multiple isolated Claude worker containers are required for permission separation.**
6. **Repos, docs, skills, tools, sessions, and logs must all be isolated by worker role.**
7. **A single Mac mini with Docker Compose is sufficient for the first-generation internal agent platform.**

This architecture prioritizes:

- Simple deployment
- Auditability
- Recoverability
- Extensibility
- Clear permission boundaries

It provides a stable foundation for AI-assisted implementation and future iteration.
