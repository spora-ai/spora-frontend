/**
 * useTaskChat — pure helpers for the TaskChatPage.
 *
 * Extracts derived state and small formatters so the SFC keeps only the
 * template and the wiring to the task store. Everything in this file takes
 * inputs and returns values — no Vue lifecycle, no DOM, no store calls.
 */
import type { HistoryEntry, TaskDetail, ToolCall } from '@/types/task'

export const RETRYABLE_ERROR_CODES = [
  'RATE_LIMIT',
  'SERVER_OVERLOADED',
  'SERVER_ERROR',
  'GATEWAY_ERROR',
  'AUTH_ERROR',
  'LLM_TIMEOUT',
  'ORPHANED',
] as const

export const NON_RETRYABLE_ERROR_CODES = [
  'NO_LLM_CONFIGURATION',
  'UNKNOWN',
] as const

export type RetryableErrorCode = typeof RETRYABLE_ERROR_CODES[number]
export type NonRetryableErrorCode = typeof NON_RETRYABLE_ERROR_CODES[number]

export interface RetryState {
  /** Set when the task is in a retry chain. */
  isRetryTask: boolean
  /** Whether the agent has auto-retry configured. */
  autoRetryConfigured: boolean
  /** 1-indexed attempt counter. */
  retryAttempt: number
  /** Maximum number of retries configured. */
  maxRetryAttempts: number
  /** True when retry_after is set AND more retries remain. */
  canAutoRetry: boolean
  /** True when retry_after is set AND no more retries remain. */
  retriesExhausted: boolean
  /** True when retry_after is set AND max_retries is 0 (never fires). */
  autoRetryDisabled: boolean
}

/** Format the ms-until-retry as a "m:ss" countdown. */
export function formatCountdown(retryAfterIso: string | null | undefined): string {
  if (!retryAfterIso) return ''
  const ms = Math.max(0, new Date(retryAfterIso).getTime() - Date.now())
  if (ms <= 0) return '0:00'
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Truncate text to a max length, appending an ellipsis if needed. */
export function truncateText(text: string | null, max = 300): string {
  if (!text) return '(empty)'
  return text.length <= max ? text : text.slice(0, max) + '…'
}

/** True when text is longer than the max length. */
export function isTruncated(text: string | null, max = 300): boolean {
  return text !== null && text.length > max
}

/** Compute retry-related flags from a task snapshot. */
export function computeRetryState(
  retryOfTaskId: number | null | undefined,
  maxRetries: number | null | undefined,
  retryCount: number | null | undefined,
): RetryState {
  const isRetryTask = retryOfTaskId !== null && retryOfTaskId !== undefined
  const autoRetryConfigured = !isRetryTask && (maxRetries ?? 0) > 0
  const retryAttempt = (retryCount ?? 0) + 1
  const canAutoRetry =
    autoRetryConfigured && (retryCount ?? 0) < (maxRetries ?? 0)
  const retriesExhausted =
    autoRetryConfigured && (retryCount ?? 0) >= (maxRetries ?? 0)
  const autoRetryDisabled =
    !isRetryTask && (maxRetries ?? 0) === 0
  return {
    isRetryTask,
    autoRetryConfigured,
    retryAttempt,
    maxRetryAttempts: maxRetries ?? 0,
    canAutoRetry,
    retriesExhausted,
    autoRetryDisabled,
  }
}

export type ChatMessage =
  | { kind: 'user'; entry: HistoryEntry }
  | { kind: 'assistant'; entry: HistoryEntry }
  | { kind: 'tool-result'; entry: HistoryEntry }
  | { kind: 'system-marker'; entry: HistoryEntry; marker: SystemMarker }

/**
 * System marker rows written by Orchestrator::continue on the auto-abort
 * path. The backend serialises the marker as JSON in `content` with a
 * `kind` discriminator (`abort_marker` in this build). The frontend treats
 * the row as a non-conversational divider and renders a faint horizontal
 * line + UTC timestamp in its place.
 *
 * Future kinds (e.g. `rate_limit_warning`) plug in via the same `kind`
 * field — see the SWITCH in {@link parseSystemMarker}.
 */
export interface SystemMarker {
  kind: 'abort_marker'
  /** UTC ISO-8601 timestamp the marker was written. */
  at: string
}

export function parseSystemMarker(entry: HistoryEntry): SystemMarker | null {
  if (entry.role !== 'system') return null
  const raw = entry.content
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SystemMarker>
    if (!parsed || typeof parsed.kind !== 'string') return null
    // Currently the orchestrator only writes `abort_marker` system rows.
    // Future kinds (rate-limit warnings, plan changes, etc.) plug in here
    // by widening the if/return ladder.
    if (parsed.kind === 'abort_marker') {
      if (typeof parsed.at !== 'string') return null
      return { kind: 'abort_marker', at: parsed.at }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Flatten a task's history into the chat-stream shape, deduplicating the
 * final response if the last assistant entry echoes the same content.
 *
 * Tool-result entries with the same `tool_call_id` collapse to the latest:
 * tools like `sub_agent` write two `role: tool` rows per call — an immediate
 * placeholder (`"Sub-agent task #N starts…"`, written by the tool executor)
 * and a later resume payload (`"Sub-agent task #N completed: …"`, written by
 * `SubAgentService::resumeParent` once the child terminates). The LLM needs
 * to see both rows in history, but the chat UI should only render the final
 * one — otherwise the same tool card shows up twice. We keep the last
 * occurrence by `tool_call_id` and drop earlier ones.
 */
export function buildChatMessages(
  history: HistoryEntry[] | null | undefined,
  finalResponse: string | null | undefined,
): ChatMessage[] {
  if (!history) return []
  const result: ChatMessage[] = []
  for (const entry of history) {
    if (entry.role === 'user') {
      result.push({ kind: 'user', entry })
    } else if (
      entry.role === 'assistant' &&
      (entry.content_blocks?.length || entry.content)
    ) {
      result.push({ kind: 'assistant', entry })
    } else if (entry.role === 'tool') {
      result.push({ kind: 'tool-result', entry })
    } else if (entry.role === 'system') {
      const marker = parseSystemMarker(entry)
      if (marker) {
        result.push({ kind: 'system-marker', entry, marker })
      }
    }
  }
  collapseDuplicateToolResults(result)
  const last = result.at(-1)
  if (
    last?.kind === 'assistant' &&
    finalResponse !== null &&
    finalResponse !== undefined &&
    last.entry.content?.trim() === finalResponse.trim()
  ) {
    result.pop()
  }
  return result
}

/**
 * Drop earlier tool-result entries that share a `tool_call_id` with a later
 * one. Walks `messages` in two reverse passes so we can splice duplicates
 * without disturbing the indices we recorded in the first pass; mutating
 * in place preserves the caller's `ChatMessage` shape and avoids a copy.
 */
function collapseDuplicateToolResults(messages: ChatMessage[]): void {
  const lastIndexByCallId = new Map<string, number>()
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.kind !== 'tool-result') continue
    const callId = m.entry.tool_call_id
    if (!callId) continue
    if (!lastIndexByCallId.has(callId)) {
      lastIndexByCallId.set(callId, i)
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.kind !== 'tool-result') continue
    const callId = m.entry.tool_call_id
    if (!callId) continue
    if (lastIndexByCallId.get(callId) !== i) {
      messages.splice(i, 1)
    }
  }
}

/**
 * Pull the displayable `text` payload out of every `thinking` block in
 * an entry's `content_blocks`. Empty-text and redacted blocks are
 * skipped. Shared with the per-message reasoning foldout in
 * TaskChatMessageList.vue so both surfaces follow the same shape.
 */
export function thinkingBlocks(blocks: HistoryEntry['content_blocks']): string[] {
  if (!blocks) return []
  const out: string[] = []
  for (const b of blocks) {
    if (b.type !== 'thinking') continue
    if (typeof b.text !== 'string' || b.text.length === 0) continue
    out.push(b.text)
  }
  return out
}

/**
 * Resolve the joined thinking text for an assistant `ChatMessage`, or
 * null when the message carries no displayable reasoning. LLMs may
 * emit multiple `thinking` blocks per turn; we concat them with a blank
 * line so the row preserves order. Redacted-only blocks return null.
 *
 * Shared between the pill (which interleave reasoning with tool rows)
 * and the test surface — see `tests/composables/useTaskChat.spec.ts`.
 */
export function reasoningForChatMessage(msg: ChatMessage): string | null {
  if (msg.kind !== 'assistant') return null
  const thinkings = thinkingBlocks(msg.entry.content_blocks)
  if (thinkings.length === 0) return null
  return thinkings.join('\n\n')
}

/**
 * A "block" is the unit the compact tool stream renders as a single pill.
 *
 * Block boundaries are placed at:
 *   - every user message (a new user turn starts)
 *   - every sub-agent tool result (a delegated workflow takes over)
 *
 * Inside a block we keep every assistant, tool-result, and system-marker
 * entry that isn't itself a block boundary. The pill summarises reasoning
 * and tool calls; intermediate assistant bubbles + the final response are
 * rendered inline by the parent (TaskChatMessageList).
 */
export interface ChatBlock {
  /** Stable id (sequential index). Used as the key in expandedStreams. */
  id: number
  /** The user message that triggered this block, if any. Sub-agent blocks have null. */
  userMessage: HistoryEntry | null
  /** All non-boundary messages in this block, in chat-stream order. */
  messages: ChatMessage[]
  /**
   * The last assistant entry in this block whose content is non-empty.
   * Rendered as the assistant bubble after the pill. May be null for
   * blocks where the agent only emitted reasoning + tool calls (no
   * conversational text — should be rare but possible).
   */
  finalResponseEntry: HistoryEntry | null
  /** True when this block was opened by a sub-agent call rather than a user message. */
  isSubAgentBlock: boolean
}

/**
 * Walk the chat stream and emit one block per user-turn (and per
 * sub-agent boundary). Sub-agent blocks contain the sub-agent's own
 * tool-result row plus whatever followed it (assistant reasoning +
 * tool calls + final response).
 *
 * Pre-user messages (assistant content before the first user msg) are
 * folded into an opening block with `userMessage: null` so the pill
 * surface still renders them; without that guard an early assistant
 * message would orphan.
 */
export function buildChatBlocks(messages: ChatMessage[], task: TaskDetail): ChatBlock[] {
  const blocks: ChatBlock[] = []
  let current: ChatBlock | null = null

  const flushCurrentBlock = (): ChatBlock | null => {
    if (current !== null) {
      blocks.push(current)
    }
    return null
  }

  const newBlockForUser = (msg: Extract<ChatMessage, { kind: 'user' }>): ChatBlock => ({
    id: blocks.length,
    userMessage: msg.entry,
    messages: [],
    finalResponseEntry: null,
    isSubAgentBlock: false,
  })

  const newBlockForSubAgent = (msg: ChatMessage): ChatBlock => ({
    id: blocks.length,
    userMessage: null,
    messages: [msg],
    finalResponseEntry: null,
    isSubAgentBlock: true,
  })

  const appendToBlock = (msg: ChatMessage): void => {
    // Pre-user messages (assistant content before the first user msg)
    // or system-markers before any user action — group them into an
    // opening block so they still render.
    current ??= {
      id: blocks.length,
      userMessage: null,
      messages: [],
      finalResponseEntry: null,
      isSubAgentBlock: false,
    }
    current.messages.push(msg)
  }

  for (const msg of messages) {
    if (msg.kind === 'user') {
      current = flushCurrentBlock()
      current = newBlockForUser(msg)
    } else if (msg.kind === 'tool-result' && isSubAgentToolResult(task, msg)) {
      current = flushCurrentBlock()
      current = newBlockForSubAgent(msg)
    } else {
      appendToBlock(msg)
    }
  }

  flushCurrentBlock()

  // For each block, find the last assistant message with non-empty
  // content as the final response. Empty-content assistant messages
  // (e.g. reasoning-only) don't become bubbles — their text lives in
  // the pill's reasoning rows.
  const assignFinalResponse = (block: ChatBlock): void => {
    for (let i = block.messages.length - 1; i >= 0; i--) {
      const m = block.messages[i]
      if (m === undefined) continue
      if (m.kind !== 'assistant') continue
      const content = m.entry.content?.trim() ?? ''
      if (content.length > 0) {
        block.finalResponseEntry = m.entry
        return
      }
    }
  }

  for (const block of blocks) {
    assignFinalResponse(block)
  }

  return blocks
}

/**
 * True when the message's `result_data.op === 'sub_agent'`. These rows
 * get a dedicated `SubAgentToolCall` card outside the compact pill so
 * live multi-child status (started/running/done) can be tracked. The
 * pill filters them out so the same row isn't shown twice.
 */
export function isSubAgentToolResult(task: TaskDetail, msg: ChatMessage): boolean {
  if (msg.kind !== 'tool-result') return false
  const callId = msg.entry.tool_call_id
  if (!callId) return false
  const data = toolResultDataByCallId(task).get(callId)
  return data?.op === 'sub_agent'
}

/**
 * True when the message is a successful `todo` write — those rows render
 * the dedicated `TodoToolCall` plan panel outside the pill. Failed or
 * rejected writes fall through to the generic row surface so the
 * operator sees the error in context.
 */
export function isTodoWriteToolResult(task: TaskDetail, msg: ChatMessage): boolean {
  if (msg.kind !== 'tool-result') return false
  if (msg.entry.tool_name !== 'todo') return false
  const tc = toolCallForEntry(task, msg)
  if (!tc) return false
  if (tc.status === 'FAILED' || tc.status === 'REJECTED') return false
  if (tc.operation !== null && tc.operation !== 'write') return false
  return true
}

/** Human-readable label for a failing task's error code. */
export function formatErrorCode(code: string | null | undefined): string {
  return code?.replace('_', ' ').toLowerCase() ?? ''
}

/** Per-tool in-flight state helpers shared with ToolApprovalBar. */
export function makeInFlightMaps(): {
  perToolApproving: Record<number, boolean>
  perToolRejecting: Record<number, boolean>
} {
  return { perToolApproving: {}, perToolRejecting: {} }
}

/** Map a pending list + provider-call-id to a ToolCall id (for in-flight flags). */
export function findToolCallId(
  pending: Array<{ id: number; provider_call_id: string }> | null | undefined,
  providerCallId: string,
): number | undefined {
  return pending?.find((t) => t.provider_call_id === providerCallId)?.id
}

/**
 * Reverse-map a tool-result history row to its ToolCall by matching either
 * the provider-side id (LLM tool-calling payload) or the DB-side id
 * (fallback for older runs that didn't record the provider id). Shared
 * across TaskChatMessageList and CompactToolStream so they can't drift.
 */
export function toolCallForEntry(task: TaskDetail, entry: ChatMessage): ToolCall | null {
  if (entry.kind !== 'tool-result') return null
  const callId = entry.entry.tool_call_id
  if (!callId) return null
  for (const tc of task.tool_calls ?? []) {
    if (tc.provider_call_id === callId || String(tc.id) === callId) {
      return tc
    }
  }
  return null
}

/**
 * Index the task's `tool_calls[*].result_data` by both the provider-side
 * and DB-side call id so a chat row can resolve its result without
 * re-walking `tool_calls`. Same lookup contract as {@link toolCallForEntry}.
 */
export function toolResultDataByCallId(task: TaskDetail): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>()
  for (const tc of task.tool_calls ?? []) {
    if (tc.result_data) {
      map.set(tc.provider_call_id, tc.result_data)
      map.set(String(tc.id), tc.result_data)
    }
  }
  return map
}

/**
 * Summary of a successful `skill_read of SKILL.md` tool call — used by
 * both the row surface (header summary) and any legacy callers. Returns
 * null for skill rows that should fall through to the generic stream
 * (non-SKILL.md filenames, FAILED / REJECTED calls, no matching ToolCall).
 */
export interface LoadedSkillInfo {
  name: string
  bytes: number
}

export function loadedSkillForEntry(task: TaskDetail, entry: ChatMessage): LoadedSkillInfo | null {
  if (entry.kind !== 'tool-result') return null
  if (entry.entry.tool_name !== 'skill') return null
  const tc = toolCallForEntry(task, entry)
  if (!tc) return null
  // Failed or rejected skill_read calls fall back to the generic card so
  // the operator sees the error in context. Without this guard a
  // path-traversal block or an oversize-file error would still render as a
  // "Loaded skill: <slug>" badge with 0 bytes.
  if (tc.status === 'FAILED' || tc.status === 'REJECTED') return null
  const args = (tc.approved_arguments ?? tc.proposed_arguments) as Record<string, unknown> | null
  if (!args) return null
  if (args.action !== 'read') return null
  // `filename` is optional and defaults to SKILL.md; treat absent as a
  // match. Any other filename falls through to the generic card.
  if (args.filename !== undefined && args.filename !== null && args.filename !== '' && args.filename !== 'SKILL.md') {
    return null
  }
  const data = toolResultDataByCallId(task).get(entry.entry.tool_call_id ?? '') ?? null
  const name = (typeof data?.name === 'string' ? data.name : null)
    ?? (typeof args.name === 'string' ? args.name : null)
    ?? '?'
  const bytes = typeof data?.bytes === 'number' ? data.bytes : 0
  return { name, bytes }
}
