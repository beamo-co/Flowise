# Implementation Plan for AI Coding

## 1. Goal

This plan turns the tech design into a practical implementation sequence that can be executed by AI coding tools with minimal ambiguity.

Primary delivery target:

- single-machine deployment on Mac mini
- Docker Compose based
- Flowise orchestration layer
- Slack bridge integration layer
- multiple role-isolated Claude workers

---

## 2. Recommended Repository Layout

```text
agent-platform/
  .env.example
  docker-compose.yml
  README.md
  docs/
    tech-design.md
    claude-worker-api-spec.md
    implementation-plan.md
  services/
    claude-worker/
      Dockerfile
      package.json
      src/
        index.ts
        config/
        api/
        jobs/
        sessions/
        workspace/
        approvals/
        logging/
        sdk/
        policies/
        tools/
    slack-bridge/
      Dockerfile
      package.json
      src/
        index.ts
        slack/
        flowise/
        mapping/
        formatting/
        approvals/
  flowise/
    exports/
      agentflows/
      chatflows/
  skills/
    coding/
    support/
    qa/
  data/
    .gitkeep
```

---

## 3. Delivery Phases

## Phase 0: Repo Bootstrap

### Tasks

1. Create monorepo structure.
2. Add `.env.example`.
3. Add `docker-compose.yml` draft.
4. Add top-level `README.md` with boot instructions.
5. Add `docs/` folder and commit design documents.

### Definition of done

- Repo structure exists.
- Team can clone and understand how the system is organized.

---

## Phase 1: Claude Worker Foundation

### Objective

Build a single generic worker service that can later be instantiated as coding/support/qa workers.

### Tasks

1. Initialize Node.js TypeScript service.
2. Add health endpoint.
3. Add config loading from env.
4. Add role-aware configuration structure:
   - `WORKER_ROLE`
   - `SESSION_NAMESPACE`
   - `SKILL_DIR`
   - `DATA_ROOT`
   - `MAX_CONCURRENCY`
5. Add a simple in-memory queue abstraction.
6. Add structured logger.
7. Add local file log writer.

### APIs to implement first

- `GET /health`
- `POST /jobs` (mock job)
- `GET /jobs/:id`
- `GET /jobs/:id/result`

### Definition of done

- Worker builds in Docker.
- A mock job can be created and polled.

---

## Phase 2: Persistent State Layer

### Objective

Persist jobs, sessions, approvals, and event metadata.

### Tasks

1. Choose storage implementation:
   - MVP option A: SQLite
   - MVP option B: Postgres
2. Add schema migration support.
3. Define tables:
   - `jobs`
   - `job_events`
   - `sessions`
   - `approvals`
   - `slack_thread_bindings` (used later by bridge)
4. Add repository layer.
5. Update APIs to read/write persistent state.

### Definition of done

- Worker restarts do not lose job/session metadata.
- Event history can be queried after restart.

---

## Phase 3: Claude SDK Integration

### Objective

Replace mock execution with real Claude Agent SDK execution.

### Tasks

1. Integrate Claude Agent SDK.
2. Add config for `CLAUDE_CODE_PATH`.
3. Implement SDK runner module.
4. Support:
   - `cwd`
   - `resume`
   - `permissionMode`
5. Stream SDK events into job event store.
6. Translate SDK runtime events into internal event types.
7. Persist returned `session_id` mapping.

### Important constraints

- Do not expose unrestricted filesystem access.
- All paths must be validated against allowed roots.

### Definition of done

- A real Claude task can be created through `POST /jobs`.
- Status and result endpoints reflect live execution.

---

## Phase 4: Workspace and Worktree Manager

### Objective

Make coding jobs safe and concurrent.

### Tasks

1. Implement repo registry configuration.
2. Implement repo path validation.
3. Add workspace manager.
4. Add worktree lifecycle:
   - prepare worktree
   - cleanup or retain
5. For coding worker:
   - keep persistent repo clones under `/data/repos`
   - create per-job worktree under `/data/workspaces/job-{id}`
6. Persist workspace path in job metadata.

### Definition of done

- Two coding jobs can run against the same repo without sharing a mutable directory.

---

## Phase 5: Approval System

### Objective

Introduce human approval gates for sensitive actions.

### Tasks

1. Implement approval persistence.
2. Add approval gateway module.
3. Wire SDK tool permission requests into approval gateway.
4. Add endpoint:
   - `POST /approvals/:approval_id`
5. Update job status machine:
   - `running -> waiting_approval -> running`
6. Emit approval-related events.

### Definition of done

- Worker pauses correctly on approval.
- Approve/deny resumes or terminates execution correctly.

---

## Phase 6: Event Streaming

### Objective

Expose worker execution updates as SSE.

### Tasks

1. Implement `GET /jobs/:id/events` as SSE.
2. Stream stored events and live events.
3. Define event payload schema.
4. Add sequence numbers for replay and ordering.
5. Make sure logs are also written to disk.

### Definition of done

- A client can subscribe to live progress for a running job.
- On reconnect, events can be re-read from persistent storage.

---

## Phase 7: Role-Isolated Worker Containers

### Objective

Instantiate multiple isolated workers from the same base image.

### Tasks

1. Finalize worker role config model.
2. Create compose services:
   - `claude-worker-coding`
   - `claude-worker-support`
   - optional `claude-worker-qa`
3. Set role-specific env values.
4. Mount role-specific volumes.
5. Mount role-specific skill directories.
6. Restrict toolset by role.

### Definition of done

- Support worker cannot access code repo mounts.
- Coding worker cannot access support docs mounts.

---

## Phase 8: Flowise Integration

### Objective

Make Flowise the orchestration layer.

### Tasks

1. Bring up Flowise in Docker Compose.
2. Configure database-backed Flowise persistence.
3. Create initial tools in Flowise:
   - `CreateCodingJob`
   - `GetJobStatus`
   - `GetJobResult`
   - `ApproveJobAction`
4. Build first Agentflow:
   - create job
   - save `job_id`
   - loop on status
   - branch on terminal state
5. Export flow definitions into version-controlled files if possible.

### Definition of done

- A Flowise agentflow can launch a coding job and return its result.

---

## Phase 9: Slack Bridge

### Objective

Connect Slack threads to Flowise sessions and worker jobs.

### Tasks

1. Create Slack bridge service.
2. Choose Slack integration mode:
   - Socket Mode recommended for internal deployment
3. Implement thread binding store:
   - `channel_id + thread_ts -> flowise_session_id`
4. Add Flowise client module.
5. Add SSE consumer for Flowise streaming output.
6. Add Slack message updater with rate-limited edits.
7. Add approval button actions.
8. Add worker status message formatting.

### Definition of done

- A Slack thread can trigger a Flowise flow.
- Responses stream back into the same thread.
- Approval actions from Slack reach the worker.

---

## Phase 10: Skills, Policies, and Tool Contracts

### Objective

Stabilize behavior through version-controlled role-specific instructions.

### Tasks

1. Create `skills/coding/` documents:
   - `use-worktree.md`
   - `create-pr.md`
   - `code-review.md`
2. Create `skills/support/` documents:
   - `answer-customer.md`
   - `escalate-issue.md`
3. Define policy registry for tools.
4. Implement validation that tool names map to allowed role policies.
5. Add structured result contract per tool.

### Definition of done

- Behavior is no longer only buried inside prompts.
- Tool-specific execution rules are explicit and versioned.

---

## Phase 11: Logging and Admin Visibility

### Objective

Make the system operable in daily use.

### Tasks

1. Standardize text logs and JSONL event logs.
2. Ensure per-job log file creation.
3. Add `GET /jobs?status=running` endpoint.
4. Add basic admin CLI or script to inspect jobs.
5. Document usage of:
   - `docker compose logs -f`
   - event endpoint
   - log directories

### Definition of done

- Engineers can inspect a failing job without attaching a debugger.

---

## Phase 12: Hardening and Smoke Tests

### Objective

Make deployment repeatable on Mac mini.

### Tasks

1. Add startup checks:
   - missing env values
   - invalid volume mounts
   - missing Claude CLI
2. Add smoke test scripts:
   - worker health test
   - create mock job
   - run simple Claude task
   - verify Flowise API
   - verify Slack bridge connection
3. Add deployment runbook.

### Definition of done

- A new machine can be provisioned with predictable results.

---

## 4. API-First Coding Order

Recommended coding order inside `claude-worker`:

1. `config`
2. `logger`
3. `models`
4. `repositories`
5. `job-controller`
6. `session-manager`
7. `workspace-manager`
8. `approval-gateway`
9. `sdk-runner`
10. `event-streamer`
11. `api routes`

---

## 5. Suggested AI Coding Prompts

## 5.1 Worker bootstrap prompt

Build a Node.js TypeScript service called `claude-worker`.
Requirements:
- Express or Fastify
- health endpoint
- job endpoints
- persistent storage abstraction
- role-aware config via env
- structured JSON logging
- Dockerfile included

## 5.2 SDK integration prompt

Integrate Claude Agent SDK into `claude-worker`.
Requirements:
- support `cwd`
- support `resume`
- support `permissionMode`
- translate SDK events into internal event schema
- write events to storage and JSONL logs

## 5.3 Slack bridge prompt

Build a Node.js Slack bridge service.
Requirements:
- Slack Socket Mode
- map Slack thread to Flowise session ID
- call Flowise prediction API with streaming enabled
- update Slack message incrementally
- support approval button actions

## 5.4 Flowise agentflow prompt

Design a Flowise Agentflow that:
- creates a Claude job via HTTP tool
- stores `job_id` in flow state
- loops on job status
- branches on `running`, `waiting_approval`, `succeeded`, `failed`
- fetches final result when succeeded

---

## 6. MVP Acceptance Criteria

The MVP is complete when all of the following work:

1. `docker compose up -d --build` starts the platform.
2. Coding worker can create and execute a real Claude job in an isolated workspace.
3. Support worker is container-isolated from code repos.
4. Flowise can create a worker job and poll for result.
5. Slack thread can trigger a flow and receive streamed updates.
6. Approval flow works end-to-end.
7. A failed job can be debugged from logs and stored events.

---

## 7. Nice-to-Have After MVP

- simple admin web UI
- richer observability
- QA worker with knowledge store
- retry policies
- dead-letter queue for failed jobs
- automated cleanup of stale workspaces
- flow export/import automation

---

## 8. Practical Notes

- Prefer SQLite for very first iteration if Postgres slows you down.
- Prefer Socket Mode for Slack on a local/internal machine.
- Keep Claude concurrency conservative on Mac mini.
- Do not let agent workers call each other directly; orchestration should stay above them.
- Do not rely only on prompt-level restrictions for isolation.

---

## 9. Final Recommendation

Start with this minimal path:

1. coding worker
2. support worker
3. Flowise integration
4. Slack bridge
5. approvals

Do not start with:

- QA worker
- admin UI
- advanced monitoring
- highly generalized plugin framework

That sequence gives the fastest path to a usable internal platform.
