import type { ContentBlock, Usage } from '@/types/usage'

export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PENDING_APPROVAL' | 'CANCELLED' | 'AWAITING_SUB_AGENTS' | 'AWAITING_INPUT' | 'ABORTED'

export type TaskErrorCode = 'RATE_LIMIT' | 'SERVER_OVERLOADED' | 'SERVER_ERROR' | 'GATEWAY_ERROR' | 'AUTH_ERROR' | 'LLM_TIMEOUT' | 'BAD_REQUEST' | 'TOOL_ERROR' | 'UNKNOWN' | 'ORPHANED' | 'NO_LLM_CONFIGURATION'

export type ToolCallStatus = 'PENDING' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED' | 'DISABLED'

/**
 * Quiescent task states where the agent loop is *not* driving the task —
 * the worker should not be polling for progress, and the chat UI should
 * show a banner + accept a follow-up prompt instead. ABORTED is a user-
 * initiated pause; PENDING_APPROVAL awaits human tool decisions;
 * AWAITING_SUB_AGENTS waits on long-running sub-agent children.
 */
export const QUIESCENT_STATUSES = new Set<TaskStatus>([
  'ABORTED',
  'PENDING_APPROVAL',
  'AWAITING_SUB_AGENTS',
])

export interface Task {
  id: number
  agent_id: number
  status: TaskStatus
  user_prompt: string
  final_response: string | null
  step_count: number
  max_steps: number | null
  parent_task_id?: number
  error_code?: TaskErrorCode | null
  error_message?: string | null
  failure_reason?: string | null
  retry_of_task_id?: number | null
  retry_count?: number
  retry_after?: string | null
  max_retries?: number | null
  retry_after_minutes?: number | null
  /**
   * Wall-clock UTC ISO-8601 stamp set when the task was aborted via the
   * `POST /tasks/{id}/abort` endpoint or auto-aborted via `continue` on
   * a RUNNING source. Used by the chat timeline to render the abort-
   * marker divider with the correct timestamp. Null on every status
   * other than ABORTED.
   */
  aborted_at?: string | null
  created_at: string
  updated_at: string
}

export interface ToolCall {
  id: number
  provider_call_id: string
  tool_name: string
  tool_type: string
  operation: string | null
  operation_description: string | null
  status: ToolCallStatus
  proposed_arguments: Record<string, unknown> | null
  approved_arguments: Record<string, unknown> | null
  human_description: string | null
  result_content: string | null
  executed_at: string | null
  /**
   * Structured data from ToolResult::data. The `op` field discriminates
   * tool-specific result shapes: `op: 'sub_agent'` supplies the plural
   * `spawned_sub_task_ids: number[]`, while legacy handovers expose
   * `new_task_id` with `handover: true`.
   */
  result_data?: Record<string, unknown> | null
  /**
   * JSON Schema for this tool's parameters, derived at serialization time
   * from the live tool instance. Used to render parameters in #[ToolParameter]
   * declaration order in the approval UI, and to drive typed inputs (enum,
   * number, boolean) where the schema provides hints. Optional because
   * historical tool calls whose tool class is no longer registered will be
   * serialized without it.
   */
  parameter_schema?: ParameterSchema
}

/** JSON Schema "parameters" object emitted by ToolParameterSchemaBuilder. */
export interface ParameterSchema {
  type: 'object'
  /**
   * Object map keyed by parameter name. Insertion order is significant — it
   * mirrors #[ToolParameter] declaration order and drives the approval UI's
   * field render order. May be an empty object when the tool takes no params.
   */
  properties: Record<string, ParameterProperty>
  required: string[]
}

export interface ParameterProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'
  description?: string
  enum?: string[]
  default?: unknown
  minimum?: number
  maximum?: number
  format?: string
  items?: ParameterProperty
}

export interface HistoryEntry {
  sequence: number
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string | null
  /**
   * Structured content blocks (`text`, `image`, `thinking`,
   * `redacted_thinking`, `tool_use`). Null for sessions that predate
   * structured content; visible message text remains available through
   * the flat `content` field.
   */
  content_blocks?: ContentBlock[] | null
  /**
   * Media Archive UUIDs the user attached on this turn. Refs only —
   * the frontend resolves them to `MediaAsset` payloads via
   * `POST /api/v1/media/resolve`. Populated only on the `user` row
   * that immediately precedes the merged attachment turn (the
   * orchestrator writes a separate `role=attachment` row, but
   * MessageHistoryBuilder folds it into the user turn at render
   * time; the backend emits the refs on the merged user row).
   */
  attachments?: HistoryAttachment[] | null
  /**
   * Per-turn token accounting. Null for user/tool turns and for any
   * assistant turn where the LLM driver did not return a usage row
   * (e.g. mid-stream interruption, or the legacy Chat Completions
   * driver before the cache observability patch).
   */
  usage?: Usage | null
  tool_call_id: string | null
  tool_name: string | null
}

/**
 * Wire projection of a single Media Archive row referenced from
 * {@link HistoryEntry.attachments}. Resolved to a full
 * {@link import('@/types/media').MediaAsset} on the client via
 * `useMediaAssetCache` for rendering.
 */
export interface HistoryAttachment {
  media_id: string
  /** Server-classified kind — `image` for `image/*` mimes, else `text`. */
  kind: 'image' | 'text'
}

export interface TaskDetail extends Task {
  tool_calls: ToolCall[]
  history: HistoryEntry[]
  /**
   * Per-role aggregate of every assistant turn's `usage`. Null when
   * the task has no recorded usage rows yet. The aggregate intentionally
   * does NOT collapse across providers — operators should not compare
   * an OpenAI total against an Anthropic total without first splitting
   * by `provider`.
   */
  totals?: Usage | null
  /**
   * Free-form JSON column on the Task model. Used by `HandoverTool`
   * (sub_agent op) to record `spawned_sub_task_ids` so the parent
   * chat can render the sub-agent row widget. Optional because the
   * field is only populated by tools that opt in.
   */
  data?: Record<string, unknown> | null
  /**
   * Top-level `pending_questions` for the `ask_user_question` tool,
   * surfaced by the backend at the same level as `data` (mirrors the
   * Mercure event payload shape). Optional because older rows
   * predating the wire change do not carry the field; nullable because
   * the backend publishes `null` once the last outstanding batch has
   * been answered. The task store mirrors this into `data.pending_questions`
   * so the picker reads via the same key the SSE merge path uses.
   */
  pending_questions?: PendingQuestionBatch[] | null
}

/**
 * One todo entry surfaced by the `TodoTool` core tool. Persisted under
 * `tasks.data.todos.items` and republished on every todo write so the
 * chat UI can render a live checklist alongside the messages.
 *
 * `activeForm` is optional (Claude Code lets it fall back to `content`)
 * and `id` is server-assigned from a UUID when the LLM doesn't supply
 * one. `order` is preserved from input ordering so the UI can render
 * items in the order the agent declared them.
 */
export interface TodoItem {
  id: string | null
  content: string
  activeForm: string | null
  status: 'pending' | 'in_progress' | 'completed'
  order: number
}

/**
 * Wrapper around `TodoItem[]`. Persisted under `tasks.data.todos`.
 * `version` is the schema version (1 for now) so future format
 * migrations can detect older rows; `updatedAt` is the wall-clock
 * UTC stamp of the last successful write.
 */
export interface TodoState {
  version: number
  items: TodoItem[]
  updatedAt: string | null
}

/**
 * One option on an `AskUserQuestion` prompt. `preview` is rendered in
 * a side panel only while the option is focused (opencode-compatible
 * preview behaviour); `description` is the always-visible caption.
 */
export interface PendingQuestionOption {
  label: string
  description: string | null
  preview: string | null
}

/**
 * One structured question inside a single `ask_user_question` tool call.
 * The whole batch (1-4 questions) shares one `tool_call_id` and one
 * backend round-trip — see `PendingQuestionBatch` and the
 * `POST /tasks/{id}/answer` endpoint for the batched submit contract.
 */
export interface PendingQuestion {
  question: string
  header: string
  options: PendingQuestionOption[]
  multiple: boolean
  allowFreeText: boolean
}

/**
 * One outstanding batch parked on a task. Multiple batches may be
 * outstanding at once (the backend keeps `AWAITING_INPUT` until every
 * batch is answered); the chat surfaces them one at a time, oldest
 * first.
 */
export interface PendingQuestionBatch {
  tool_call_id: string
  questions: PendingQuestion[]
}

/**
 * Wire shape for `POST /tasks/{id}/answer`. One payload covers every
 * question in the batch atomically — partial submissions are
 * rejected by the backend so the LLM never sees a half-answered
 * batch. `selections` is the option labels the user chose; `free_text`
 * is the typed answer (only valid when the question's
 * `allowFreeText` is true).
 */
export interface AnswerTaskPayload {
  tool_call_id: string
  answers: Array<{
    header: string
    selections: string[]
    free_text: string | null
  }>
}
