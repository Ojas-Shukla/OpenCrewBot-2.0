// App storage: bots, rooms, and the chat transcript the UI shows. Mastra keeps
// its own store (mastra.db) for each bot's model-facing thread history.
import { createClient, type Client } from "@libsql/client";
import { APP_DB_URL } from "./config";
import type {
  ApprovalRequest,
  Bot,
  ChatMessage,
  ConversationId,
  ExecutionRun,
  ExecutionTask,
  MemoryRecord,
  Room,
  ScheduledWorkflow,
  ReusableSkill,
  WorkflowTemplate,
} from "@/lib/shared/types";

// Cached across hot reloads, together with the file it points at, so a
// changed database path opens a fresh connection instead of reusing one
// bound to a file that has moved.
const g = globalThis as unknown as { __opencrewbotDb?: { url: string; schema?: number; client: Promise<Client> } };

/** Bump when a table is added, so a hot-reloaded server re-runs the CREATE statements. */
const SCHEMA_VERSION = 4;

async function open(): Promise<Client> {
  const db = createClient({ url: APP_DB_URL });
  await db.batch(
    [
      "CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, data TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, data TEXT NOT NULL)",
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        data TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages (conversation_id, created_at)",
      "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data TEXT NOT NULL)",
      `CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        generation INTEGER NOT NULL DEFAULT 0,
        last_read_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS execution_runs (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS execution_runs_by_created ON execution_runs (created_at)",
      `CREATE TABLE IF NOT EXISTS execution_tasks (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS execution_tasks_by_run ON execution_tasks (run_id, created_at)",
      `CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS memory_records_by_owner ON memory_records (scope, owner_id, created_at)",
      `CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY, event_type TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS audit_events_by_created ON audit_events (created_at)",
      `CREATE TABLE IF NOT EXISTS workflow_templates (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS scheduled_workflows (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS scheduled_workflows_by_status ON scheduled_workflows (status, created_at)",
      `CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS workflow_runs_by_workflow ON workflow_runs (workflow_id, created_at)",
      `CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL
      )`,
    ],
    "write",
  );
  return db;
}

export function db(): Promise<Client> {
  const cached = g.__opencrewbotDb;
  if (cached?.url === APP_DB_URL && cached.schema === SCHEMA_VERSION) return cached.client;
  // Close the old connection (an older build cached the bare promise).
  const stale = cached && "client" in cached ? cached.client : (cached as unknown as Promise<Client> | undefined);
  void stale?.then((c) => c.close()).catch(() => {});
  const client = open();
  g.__opencrewbotDb = { url: APP_DB_URL, schema: SCHEMA_VERSION, client };
  return client;
}

// ── settings (small JSON values) ────────────────────────────────────────

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM settings WHERE key = ?", args: [key] });
  return rows.rows[0] ? (JSON.parse(String(rows.rows[0].data)) as T) : undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO settings (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data",
    args: [key, JSON.stringify(value)],
  });
}

// ── bots ────────────────────────────────────────────────────────────────

/** Fill in fields added after a bot was saved, so older rows keep working. */
function normalizeBot(raw: Bot): Bot {
  return {
    ...raw,
    connections: raw.connections ?? [],
  };
}

export async function listBots(): Promise<Bot[]> {
  const rows = await (await db()).execute("SELECT data FROM bots");
  return rows.rows
    .map((r) => normalizeBot(JSON.parse(String(r.data)) as Bot))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getBot(id: string): Promise<Bot | null> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM bots WHERE id = ?", args: [id] });
  return rows.rows[0] ? normalizeBot(JSON.parse(String(rows.rows[0].data)) as Bot) : null;
}

export async function saveBot(bot: Bot): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO bots (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    args: [bot.id, JSON.stringify(bot)],
  });
}

export async function deleteBotRow(id: string): Promise<void> {
  await (await db()).execute({ sql: "DELETE FROM bots WHERE id = ?", args: [id] });
}

// ── rooms ───────────────────────────────────────────────────────────────

export async function listRooms(): Promise<Room[]> {
  const rows = await (await db()).execute("SELECT data FROM rooms");
  return rows.rows
    .map((r) => JSON.parse(String(r.data)) as Room)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getRoom(id: string): Promise<Room | null> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM rooms WHERE id = ?", args: [id] });
  return rows.rows[0] ? (JSON.parse(String(rows.rows[0].data)) as Room) : null;
}

export async function saveRoom(room: Room): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO rooms (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    args: [room.id, JSON.stringify(room)],
  });
}

export async function deleteRoomRow(id: string): Promise<void> {
  await (await db()).execute({ sql: "DELETE FROM rooms WHERE id = ?", args: [id] });
}

// ── messages ────────────────────────────────────────────────────────────

export async function saveMessage(message: ChatMessage): Promise<void> {
  await (await db()).execute({
    sql: `INSERT INTO messages (id, conversation_id, created_at, data) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    args: [message.id, message.conversationId, message.createdAt, JSON.stringify(message)],
  });
}

export async function listMessages(conversationId: ConversationId, limit = 200): Promise<ChatMessage[]> {
  const rows = await (await db()).execute({
    sql: `SELECT data FROM (
            SELECT data, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
          ) ORDER BY created_at ASC`,
    args: [conversationId, limit],
  });
  return rows.rows.map((r) => JSON.parse(String(r.data)) as ChatMessage);
}

export async function clearMessages(conversationId: ConversationId): Promise<void> {
  await (await db()).execute({ sql: "DELETE FROM messages WHERE conversation_id = ?", args: [conversationId] });
}

/** The newest message per conversation, for sidebar previews. */
export async function lastMessages(): Promise<Map<ConversationId, ChatMessage>> {
  const rows = await (await db()).execute(
    `SELECT m.data FROM messages m
     JOIN (SELECT conversation_id, MAX(created_at) AS latest FROM messages GROUP BY conversation_id) l
       ON m.conversation_id = l.conversation_id AND m.created_at = l.latest`,
  );
  const out = new Map<ConversationId, ChatMessage>();
  for (const r of rows.rows) {
    const m = JSON.parse(String(r.data)) as ChatMessage;
    out.set(m.conversationId, m);
  }
  return out;
}

export async function unreadCounts(): Promise<Map<ConversationId, number>> {
  const rows = await (await db()).execute(
    `SELECT m.conversation_id AS id, COUNT(*) AS n FROM messages m
     LEFT JOIN conversations c ON c.id = m.conversation_id
     WHERE m.created_at > COALESCE(c.last_read_at, '') AND m.data NOT LIKE '%"role":"user"%'
     GROUP BY m.conversation_id`,
  );
  return new Map(rows.rows.map((r) => [String(r.id), Number(r.n)]));
}

export async function markRead(conversationId: ConversationId): Promise<void> {
  await (await db()).execute({
    sql: `INSERT INTO conversations (id, last_read_at) VALUES (?, ?)
          ON CONFLICT(id) DO UPDATE SET last_read_at = excluded.last_read_at`,
    args: [conversationId, new Date().toISOString()],
  });
}

/** Bumped by "Clear chat" so each bot starts a fresh model-side thread. */
export async function conversationGeneration(conversationId: ConversationId): Promise<number> {
  const rows = await (await db()).execute({
    sql: "SELECT generation FROM conversations WHERE id = ?",
    args: [conversationId],
  });
  return rows.rows[0] ? Number(rows.rows[0].generation) : 0;
}

export async function bumpGeneration(conversationId: ConversationId): Promise<number> {
  await (await db()).execute({
    sql: `INSERT INTO conversations (id, generation) VALUES (?, 1)
          ON CONFLICT(id) DO UPDATE SET generation = generation + 1`,
    args: [conversationId],
  });
  return conversationGeneration(conversationId);
}

// ── durable execution records ──────────────────────────────────────────

export async function saveExecutionRun(run: ExecutionRun): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO execution_runs (id, status, created_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data",
    args: [run.id, run.status, run.createdAt, JSON.stringify(run)],
  });
}

export async function getExecutionRun(id: string): Promise<ExecutionRun | null> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM execution_runs WHERE id = ?", args: [id] });
  return rows.rows[0] ? JSON.parse(String(rows.rows[0].data)) as ExecutionRun : null;
}

export async function listExecutionRuns(limit = 50): Promise<ExecutionRun[]> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM execution_runs ORDER BY created_at DESC LIMIT ?", args: [limit] });
  return rows.rows.map((row) => JSON.parse(String(row.data)) as ExecutionRun);
}

export async function saveExecutionTask(task: ExecutionTask): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO execution_tasks (id, run_id, status, created_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data",
    args: [task.id, task.runId, task.status, task.createdAt, JSON.stringify(task)],
  });
}

export async function getExecutionTask(id: string): Promise<ExecutionTask | null> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM execution_tasks WHERE id = ?", args: [id] });
  return rows.rows[0] ? JSON.parse(String(rows.rows[0].data)) as ExecutionTask : null;
}

export async function listExecutionTasks(runId: string): Promise<ExecutionTask[]> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM execution_tasks WHERE run_id = ? ORDER BY created_at", args: [runId] });
  return rows.rows.map((row) => JSON.parse(String(row.data)) as ExecutionTask);
}

export async function writeAuditEvent(event: { id: string; type: string; createdAt: string; data: unknown }): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO audit_events (id, event_type, created_at, data) VALUES (?, ?, ?, ?)",
    args: [event.id, event.type, event.createdAt, JSON.stringify(event.data)],
  });
}

export async function listAuditEvents(limit = 100): Promise<Array<{ id: string; type: string; createdAt: string; data: unknown }>> {
  const rows = await (await db()).execute({ sql: "SELECT id, event_type, created_at, data FROM audit_events ORDER BY created_at DESC LIMIT ?", args: [limit] });
  return rows.rows.map((row) => ({ id: String(row.id), type: String(row.event_type), createdAt: String(row.created_at), data: JSON.parse(String(row.data)) }));
}

// ── memory provenance ──────────────────────────────────────────────────

export async function saveMemoryRecord(record: MemoryRecord): Promise<void> {
  await (await db()).execute({
    sql: `INSERT INTO memory_records (id, scope, owner_id, created_at, data)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET scope = excluded.scope, owner_id = excluded.owner_id, data = excluded.data`,
    args: [record.id, record.scope, record.ownerId, record.createdAt, JSON.stringify(record)],
  });
}

export async function listMemoryRecords(scope?: string, ownerId?: string, limit = 100): Promise<MemoryRecord[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (scope) {
    where.push("scope = ?");
    args.push(scope);
  }
  if (ownerId) {
    where.push("owner_id = ?");
    args.push(ownerId);
  }
  args.push(limit);
  const sql = `SELECT data FROM memory_records${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
  const rows = await (await db()).execute({ sql, args });
  return rows.rows.map((row) => JSON.parse(String(row.data)) as MemoryRecord);
}

// ── approvals ──────────────────────────────────────────────────────────

export async function saveApprovalRequest(request: ApprovalRequest): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO approval_requests (id, status, created_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data",
    args: [request.id, request.status, request.createdAt, JSON.stringify(request)],
  });
}

export async function getApprovalRequest(id: string): Promise<ApprovalRequest | null> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM approval_requests WHERE id = ?", args: [id] });
  return rows.rows[0] ? JSON.parse(String(rows.rows[0].data)) as ApprovalRequest : null;
}

export async function listApprovalRequests(limit = 100): Promise<ApprovalRequest[]> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM approval_requests ORDER BY created_at DESC LIMIT ?", args: [limit] });
  return rows.rows.map((row) => JSON.parse(String(row.data)) as ApprovalRequest);
}

// ── workflow templates and schedules ────────────────────────────────────

export async function saveWorkflowTemplate(workflow: WorkflowTemplate): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO workflow_templates (id, created_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    args: [workflow.id, workflow.createdAt, JSON.stringify(workflow)],
  });
}

export async function getWorkflowTemplate(id: string): Promise<WorkflowTemplate | null> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM workflow_templates WHERE id = ?", args: [id] });
  return rows.rows[0] ? JSON.parse(String(rows.rows[0].data)) as WorkflowTemplate : null;
}

export async function listWorkflowTemplates(limit = 100): Promise<WorkflowTemplate[]> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM workflow_templates ORDER BY created_at DESC LIMIT ?", args: [limit] });
  return rows.rows.map((row) => JSON.parse(String(row.data)) as WorkflowTemplate);
}

export async function saveScheduledWorkflow(workflow: ScheduledWorkflow): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO scheduled_workflows (id, status, created_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data",
    args: [workflow.id, workflow.status, workflow.createdAt, JSON.stringify(workflow)],
  });
}

export async function getScheduledWorkflow(id: string): Promise<ScheduledWorkflow | null> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM scheduled_workflows WHERE id = ?", args: [id] });
  return rows.rows[0] ? JSON.parse(String(rows.rows[0].data)) as ScheduledWorkflow : null;
}

export async function listScheduledWorkflows(limit = 100): Promise<ScheduledWorkflow[]> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM scheduled_workflows ORDER BY created_at DESC LIMIT ?", args: [limit] });
  return rows.rows.map((row) => JSON.parse(String(row.data)) as ScheduledWorkflow);
}

export async function saveWorkflowRun(run: ExecutionRun & { workflowId: string }): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO workflow_runs (id, workflow_id, status, created_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data",
    args: [run.id, run.workflowId, run.status, run.createdAt, JSON.stringify(run)],
  });
}

// ── reusable skills ────────────────────────────────────────────────────

export async function saveSkill(skill: ReusableSkill): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO skills (id, name, category, created_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category, data = excluded.data",
    args: [skill.id, skill.name, skill.category, skill.createdAt, JSON.stringify(skill)],
  });
}

export async function getSkill(id: string): Promise<ReusableSkill | null> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM skills WHERE id = ?", args: [id] });
  return rows.rows[0] ? JSON.parse(String(rows.rows[0].data)) as ReusableSkill : null;
}

export async function listSkills(limit = 100): Promise<ReusableSkill[]> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM skills ORDER BY name LIMIT ?", args: [limit] });
  return rows.rows.map((row) => JSON.parse(String(row.data)) as ReusableSkill);
}
