# Worker Events 增量返回设计

## 背景

当前 Flowise Agent 调用 Claude Worker 时，只能通过单独调用 `WorkerGetJobEvents` 获取 thinking chain。希望在 `WorkerGetJobStatus` 时直接返回增量 events，简化集成。

## 设计方案

### 修改内容

**Worker端 (JobManager)**:

1. 添加内存 Map `pendingEvents: Map<jobId, JobEvent[]>` 存储待返回的 events
2. 执行 job 时，同时往持久化（SQLite）和内存 Map 写入 events
3. `GET /jobs/:id` (GetJobStatus) 返回 job 状态 + pending events，然后清空该 job 的内存
4. job 完成 (SUCCEEDED/FAILED) 时，也返回剩余 events 并清空

### API 响应变化

```json
// GET /jobs/:id 响应变化
{
  "id": "job-123",
  "status": "running",
  "pendingEvents": [
    { "type": "tool_requested", "data": { "toolName": "Write", ... } },
    { "type": "tool_result", "data": { "toolName": "Write", ... } }
  ]
}
```

### 流程

```
1. Flowise Agent 调用 WorkerCreateJob → 创建 job，写入 events 到内存
2. Flowise Agent 轮询 WorkerGetJobStatus → 返回 status + pending events，清空内存
3. 重复步骤 2 直到 job 完成
4. Job 完成时 → 返回剩余 events，清空内存
```

## 实现任务

1. 修改 `JobManager` 添加 pendingEvents Map
2. 修改 `executeJob` 方法将 events 写入内存 Map
3. 修改 `getJob` 方法返回 pendingEvents 并清空
4. 在 job 完成时也清空 pendingEvents
5. 更新 `WorkerGetJobStatus` tool 的 schema 和描述

## 风险与注意事项

- 内存存储是进程级别的，重启 Worker 会丢失 pending events（可接受，因为轮询间隔短）
- 多实例部署需要共享存储（如 Redis），当前为单实例设计
