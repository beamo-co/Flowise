# Worker Events 增量返回实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 WorkerGetJobStatus API 返回时自动包含 pending events，实现增量返回并清空内存。

**Architecture:** 在 JobManager 中添加内存 Map 存储待返回的 events，调用 getJob 时返回并清空。

**Tech Stack:** TypeScript, SQLite, Express

---

## Task 1: 添加 pendingEvents Map 到 JobManager

**Files:**
- Modify: `claude-worker/src/jobs/JobManager.ts:9-15`

**Step 1: 添加 pendingEvents 属性**

在 JobManager 类中添加：

```typescript
// 在 constructor 前添加
private pendingEvents: Map<string, JobEvent[]> = new Map()
```

**Step 2: Commit**

```bash
git add claude-worker/src/jobs/JobManager.ts
git commit -m "feat(worker): add pendingEvents Map to JobManager"
```

---

## Task 2: 添加 addPendingEvent 方法

**Files:**
- Modify: `claude-worker/src/jobs/JobManager.ts`

**Step 1: 在 getJobEvents 方法后添加新方法**

```typescript
// 添加到 JobManager 类中
addPendingEvent(jobId: string, event: JobEvent): void {
  const events = this.pendingEvents.get(jobId) || []
  events.push(event)
  this.pendingEvents.set(jobId, events)
}

getAndClearPendingEvents(jobId: string): JobEvent[] {
  const events = this.pendingEvents.get(jobId) || []
  this.pendingEvents.delete(jobId)
  return events
}
```

**Step 2: Commit**

```bash
git add claude-worker/src/jobs/JobManager.ts
git commit -m "feat(worker): add pending event management methods"
```

---

## Task 3: 修改 executeJob 写入 pending events

**Files:**
- Modify: `claude-worker/src/jobs/JobManager.ts:144-181`

**Step 1: 修改 executeJob 方法，在调用 eventRepository.create 后同时调用 addPendingEvent**

在每个 `eventRepository.create` 调用后，添加对应的 `this.addPendingEvent` 调用。

需要修改的位置：
1. JobStatus.RUNNING 更新时（在 processNextJob 中调用 updateJobStatus）
2. JobStatus.SUCCEEDED 时
3. JobStatus.FAILED 时

实际上，由于 updateJobStatus 会调用 eventRepository，我们需要修改 updateJobStatus 来同时写入 pending events。

**Step 2: 修改 updateJobStatus 方法**

```typescript
updateJobStatus(id: string, status: JobStatus, output?: object): Job | null {
  const updates: any = { status }

  if (status === JobStatus.RUNNING) {
    updates.started_at = new Date()
  }

  if (status === JobStatus.SUCCEEDED || status === JobStatus.FAILED) {
    updates.completed_at = new Date()
  }

  if (output) {
    updates.output = output
  }

  const job = jobRepository.update(id, updates)

  if (job) {
    const eventType = this.statusToEventType(status)
    const event = eventRepository.create(id, eventType, output || {})

    // 同时写入 pending events
    this.addPendingEvent(id, {
      id: event.id,
      jobId: id,
      type: eventType,
      timestamp: event.created_at.toISOString(),
      data: output || {},
    })
  }

  return job
}
```

**Step 3: Commit**

```bash
git add claude-worker/src/jobs/JobManager.ts
git commit -m "feat(worker): write events to pendingEvents in updateJobStatus"
```

---

## Task 4: 修改 getJob 返回 pending events 并清空

**Files:**
- Modify: `claude-worker/src/jobs/JobManager.ts:34-37`

**Step 1: 修改 getJob 方法**

```typescript
getJob(id: string): Job | null {
  const job = jobRepository.getById(id)
  if (job) {
    // 获取并清空 pending events
    const pendingEvents = this.getAndClearPendingEvents(id)
    // 将 pending events 附加到 job 对象上（不修改原始类型）
    ;(job as any).pendingEvents = pendingEvents
  }
  return job
}
```

**Step 2: Commit**

```bash
git add claude-worker/src/jobs/JobManager.ts
git commit -m "feat(worker): return pendingEvents in getJob"
```

---

## Task 5: 验证构建

**Step 1: 构建 Worker**

```bash
cd claude-worker
pnpm build
```

**Step 2: 启动 Worker 测试**

```bash
cd claude-worker
pnpm start &
```

**Step 3: 测试 API**

```bash
# 创建 job
curl -X POST http://localhost:3001/jobs -H "Content-Type: application/json" -d '{"prompt": "test"}'

# 获取 job 状态（应该包含 pendingEvents）
curl http://localhost:3001/jobs/{jobId}
```

**Step 4: 验证多次调用后 events 清空**

```bash
# 第一次调用
curl http://localhost:3001/jobs/{jobId}
# 应该返回 pendingEvents

# 第二次调用
curl http://localhost:3001/jobs/{jobId}
# pendingEvents 应该为空数组
```

---

## Task 6: 更新 worker-tools.json (可选)

如果需要更新 tool 描述以反映新行为：

**Files:**
- Modify: `scripts/worker-tools.json:10-16`

将 description 更新为：

```json
"description": "Get the current status of a job by job ID. Returns the job state (pending, running, succeeded, failed, etc.) and pending events since last call."
```
