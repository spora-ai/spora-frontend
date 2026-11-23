/**
 * useTaskChat — pure helpers for the TaskChatPage.
 *
 * Extracts derived state and small formatters so the SFC keeps only the
 * template and the wiring to the task store. Everything in this file takes
 * inputs and returns values — no Vue lifecycle, no DOM, no store calls.
 */
import type { HistoryAttachment, HistoryEntry, TaskDetail, ToolCall } from '@/types/task'

/**
 * The codes the core will retry.
 *
 * The core's list is the authority (`ErrorClassifier::RETRYABLE_ERROR_CODES`
 * and `RetryScheduler::RETRYABLE_ERROR_CODES` in spora-core). `ORPHANED` is
 * the code the reaper used to write; it writes `WORKER_DISCONNECTED` now.
 */
export const RETRYABLE_ERROR_CODES = [
  'RATE_LIMIT',
  'SERVER_OVERLOADED',
  'SERVER_ERROR',
  'GATEWAY_ERROR',
  'AUTH_ERROR',
  'LLM_TIMEOUT',
  'ORPHANED',
  'WORKER_DISCONNECTED',
] as const

/**
 * The codes the core writes for a failure no retry can fix.
 *
 * The core's retryable list is the authority for what it will retry
 * (`ErrorClassifier::RETRYABLE_ERROR_CODES` in spora-core): a code it
 * does not name is terminal, and a terminal failure never gets a retry
 * scheduled for it.
 *
 * A code the core writes that neither list names shows the operator no
 * banner at all, so the terminal codes it writes belong here: the
 * provider's answer to a request the agent cannot fix, a usage decision
 * a retry would only spend, a prompt that does not fit the model's
 * context window, and the two bookkeeping failures of a rejection and a
 * resume.
 */
export const NON_RETRYABLE_ERROR_CODES = [
  'NO_LLM_CONFIGURATION',
  'UNKNOWN',
  'BAD_REQUEST',
  'USAGE_LIMIT_REACHED',
  'CONTEXT_WINDOW_FIRST_TURN',
  'REJECT_FAILED',
  'RESUME_FAILED',
] as const

export type RetryableErrorCode = typeof RETRYABLE_ERROR_CODES[number]
export type NonRetryableErrorCode = typeof NON_RETRYABLE_ERROR_CODES[number]

export interface RetryState {
  /** Set when the row carries the chain marker — a retry is armed on it. */
  isRetryTask: boolean
  /** Whether the agent has auto-retry configured. */
  autoRetryConfigured: boolean
  /** The attempt that is pending — the first run is attempt 1. */
  retryAttempt: number
  /** The attempts the agent's budget allows, the first run included. 0 when the agent has no policy. */
  maxRetryAttempts: number
  /** True while the agent's budget still has room for the pending retry. */
  canAutoRetry: boolean
  /** True when the agent's budget is spent. */
  retriesExhausted: boolean
  /** True when the agent has no retry policy at all. */
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

/**
 * Compute retry-related flags from a task snapshot.
 *
 * The core arms a retry on the failed row itself, so the chain marker and
 * the agent's budget travel together — the marker says a retry is armed,
 * the budget says how many there may be. The two were read as
 * alternatives, and a row that carried the marker carried no budget: the
 * browser could not tell a scheduled retry from an exhausted one, and it
 * told the operator to click Retry while the retry was already on its way.
 */
export function computeRetryState(
  retryOfTaskId: number | null | undefined,
  maxRetries: number | null | undefined,
  retryCount: number | null | undefined = 0,
): RetryState {
  const budget = maxRetries ?? 0
  // A default parameter covers `undefined` only; an explicit null is still
  // folded to zero here.
  const spent = retryCount ?? 0

  return {
    isRetryTask: retryOfTaskId !== null && retryOfTaskId !== undefined,
    autoRetryConfigured: budget > 0,
    // The pending run is the one after the attempts that already failed.
    retryAttempt: spent + 1,
    // The budget counts retries; the task gets one run more than that.
    maxRetryAttempts: budget > 0 ? budget + 1 : 0,
    canAutoRetry: budget > 0 && spent <= budget,
    retriesExhausted: budget > 0 && spent > budget,
    autoRetryDisabled: budget === 0,
  }
}

export type ChatMessage =
  | { kind: 'user'; entry: HistoryEntry }
  | { kind: 'assistant'; entry: HistoryEntry }
  | { kind: 'tool-result'; entry: HistoryEntry }
  | { kind: 'system-marker'; entry: HistoryEntry; marker: SystemMarker }
  | { kind: 'summary'; entry: HistoryEntry; count: number }

/**
 * The `"first-last"` sequence range, or null when the value is not one. */
function parseRange(range: string): [number, number] | null {
  const match = /^(\d+)-(\d+)$/.exec(range)
  if (match === null) return null
  return [Number(match[1]), Number(match[2])]
}

/**
 * How many turns a summary stands in for.
 *
 * The range the summary carries names the rows it replaced, so the turns it
 * stands in for are the ones inside that range. A summary whose range does
 * not parse stands in for nothing — the server drops it before it decides
 * what the model sees.
 */
function compactedCount(history: HistoryEntry[], entry: HistoryEntry): number {
  const range = typeof entry.summarized_sequence_range === 'string'
    ? parseRange(entry.summarized_sequence_range)
    : null
  if (range === null) return 0
  const [first, last] = range
  return history.filter(
    (row) => row.role !== 'summary' && row.sequence >= first && row.sequence <= last,
  ).length
}

/**
 * System marker rows written by Orchestrator::continue on the auto-abort
 * path. The backend serialises the marker as JSON in `content` with a `kind`
 * discriminator (`abort_marker` in this build).
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
 * Tool-result entries with the same `tool_call_id` collapse to the latest
 * — tools like `sub_agent` write two rows per call (immediate placeholder
 * + later resume payload) and the chat should only render the final one.
 *
 * An `attachment` row is a synthetic record the orchestrator writes beside
 * the turn it belongs to, and it has no role of its own on the wire. Its
 * refs are folded into that turn here — the turn before it, or the one
 * after it when the row comes first — because a row the chat drops is a
 * file the operator cannot see they attached. The backend pairs the same
 * rows for the LLM and for the agent API, but only with an adjacent turn.
 */
export function buildChatMessages(
  history: HistoryEntry[] | null | undefined,
  finalResponse: string | null | undefined,
): ChatMessage[] {
  if (!history) return []
  const result: ChatMessage[] = []
  /**
   * Refs from an `attachment` row that has no user turn to join yet.
   *
   * The orchestrator writes the row beside the turn it belongs to, but
   * "beside" is not an order: the row can come before or after the turn
   * it accompanies. The refs are held until a turn shows up to carry them.
   */
  let carried: HistoryAttachment[] = []
  let carriedSequence = 0
  for (const entry of history) {
    if (entry.role === 'attachment') {
      const pending = foldAttachmentRow(entry, result)
      if (pending === null) continue
      carried = mergeAttachments(carried, pending)
      carriedSequence = entry.sequence
      continue
    }
    if (entry.role === 'user') {
      result.push(userMessage(entry, carried))
      carried = []
      continue
    }
    const message = messageForEntry(entry, history)
    if (message !== null) {
      result.push(message)
    }
  }
  if (carried.length > 0) {
    // An attachment row with no user turn to join — no turn anywhere in
    // the history carries it. Surfacing it as a turn of its own is better
    // than dropping the files: the operator attached them, and the chat
    // is the only place they can see what they attached.
    result.push({
      kind: 'user',
      entry: {
        sequence: carriedSequence,
        role: 'user',
        content: '',
        attachments: carried,
        tool_call_id: null,
        tool_name: null,
      },
    })
  }
  collapseDuplicateToolResults(result)
  dropFinalResponse(result, finalResponse)
  return result
}

/**
 * A user turn, carrying the refs an earlier `attachment` row left for it.
 */
function userMessage(
  entry: HistoryEntry,
  carried: HistoryAttachment[],
): ChatMessage {
  return {
    kind: 'user',
    entry: carried.length === 0
      ? entry
      : { ...entry, attachments: mergeAttachments(entry.attachments, carried) },
  }
}

/**
 * The refs an `attachment` row leaves to be carried forward, or null when
 * the row was folded into the turn it belongs to.
 *
 * The turn it belongs to is the one before it. Ids the turn already
 * carries are skipped rather than repeated: the same file can be
 * referenced by both rows.
 */
function foldAttachmentRow(
  entry: HistoryEntry,
  result: ChatMessage[],
): HistoryAttachment[] | null {
  const refs = entry.attachments ?? []
  if (refs.length === 0) return null
  const index = result.length - 1
  const last = result.at(index)
  if (last?.kind !== 'user') return refs
  result[index] = {
    kind: 'user',
    entry: { ...last.entry, attachments: mergeAttachments(last.entry.attachments, refs) },
  }
  return null
}

/**
 * The chat message a non-user history row renders as, or null when it
 * renders as nothing.
 *
 * An assistant row with no prose and no content blocks carried only tool
 * calls, so it is not a message the operator reads.
 */
function messageForEntry(
  entry: HistoryEntry,
  history: HistoryEntry[],
): ChatMessage | null {
  if (entry.role === 'assistant') {
    return entry.content_blocks?.length || entry.content
      ? { kind: 'assistant', entry }
      : null
  }
  if (entry.role === 'tool') {
    return { kind: 'tool-result', entry }
  }
  if (entry.role === 'summary') {
    // The summary row was appended where the compaction happened, so it
    // marks that point in the conversation: the turns it stands in for
    // stay in the transcript, and the marker says what the model was
    // given in their place.
    return { kind: 'summary', entry, count: compactedCount(history, entry) }
  }
  if (entry.role === 'system') {
    const marker = parseSystemMarker(entry)
    return marker ? { kind: 'system-marker', entry, marker } : null
  }
  return null
}

/**
 * Two lists of attachment refs, joined without repeating an id.
 *
 * The same file can be referenced by both the user turn and the
 * `attachment` row beside it, and a turn that already lists it should not
 * show it twice.
 */
function mergeAttachments(
  first: HistoryAttachment[] | null | undefined,
  second: HistoryAttachment[],
): HistoryAttachment[] {
  const merged = [...(first ?? [])]
  const seen = new Set(merged.map((a) => a.media_id))
  for (const ref of second) {
    if (seen.has(ref.media_id)) continue
    seen.add(ref.media_id)
    merged.push(ref)
  }
  return merged
}

/**
 * Drop the turn that carries the final response.
 *
 * The chat renders the final response once, as its own bubble, so the turn
 * that carries it must not also render as an ordinary assistant bubble.
 * A compaction appends its summary row after the last turn, so the last
 * turn is looked up past the markers.
 */
function dropFinalResponse(
  messages: ChatMessage[],
  finalResponse: string | null | undefined,
): void {
  let lastTurnIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.kind === 'summary') continue
    lastTurnIndex = i
    break
  }
  const last = lastTurnIndex >= 0 ? messages[lastTurnIndex] : undefined
  if (
    last?.kind === 'assistant' &&
    finalResponse !== null &&
    finalResponse !== undefined &&
    last.entry.content?.trim() === finalResponse.trim()
  ) {
    messages.splice(lastTurnIndex, 1)
  }
}

// Walks `messages` in two reverse passes so splicing duplicates doesn't
// disturb the indices we recorded in the first pass; mutates in place.
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
 * The model's reasoning text, from either provider's block type.
 *
 * Anthropic's `thinking` block and OpenAI's `reasoning` block are the same
 * concept — what the model reasoned — so they belong in the same bubble. The
 * name keeps the Anthropic spelling because that is the type the frontend
 * has always carried.
 *
 * A block with no text is skipped. The Responses API's `summary` array can
 * be empty when no summary was requested, and an empty block must not leave
 * a separator behind in the joined text.
 */
export function thinkingBlocks(blocks: HistoryEntry['content_blocks']): string[] {
  if (!blocks) return []
  const out: string[] = []
  for (const b of blocks) {
    if (b.type !== 'thinking' && b.type !== 'reasoning') continue
    if (typeof b.text !== 'string' || b.text.length === 0) continue
    out.push(b.text)
  }
  return out
}

/**
 * The reasoning text of an assistant message, or null when it has none.
 *
 * Two reasoning blocks are joined with a blank line, so a turn that
 * reasoned twice reads as two paragraphs.
 */
export function reasoningForChatMessage(msg: ChatMessage): string | null {
  if (msg.kind !== 'assistant') return null
  const reasoning = thinkingBlocks(msg.entry.content_blocks)
  if (reasoning.length === 0) return null
  return reasoning.join('\n\n')
}

/**
 * A "block" is the unit the compact tool stream renders as a single pill.
 * Block boundaries are placed at every user message (new turn), every
 * compaction marker and every sub-agent tool result (delegated workflow
 * takes over).
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
   * Rendered as the assistant bubble after the pill.
   */
  finalResponseEntry: HistoryEntry | null
  /** True when this block was opened by a sub-agent call rather than a user message. */
  isSubAgentBlock: boolean
}

/**
 * Walk the chat stream and emit one block per user-turn (and per compaction
 * or sub-agent boundary). Pre-user messages fold into an opening block with
 * `userMessage: null` so the pill surface still renders them.
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

  const newBlockForSummary = (msg: Extract<ChatMessage, { kind: 'summary' }>): ChatBlock => ({
    id: blocks.length,
    userMessage: null,
    messages: [msg],
    finalResponseEntry: null,
    isSubAgentBlock: false,
  })

  const appendToBlock = (msg: ChatMessage): void => {
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
    } else if (msg.kind === 'summary') {
      // A compaction is an event in the conversation rather than a turn of
      // it, so it gets a block of its own: the marker stands where the
      // compaction happened instead of inside the turn that follows it.
      current = flushCurrentBlock()
      current = newBlockForSummary(msg)
    } else if (msg.kind === 'tool-result' && isSubAgentToolResult(task, msg)) {
      current = flushCurrentBlock()
      current = newBlockForSubAgent(msg)
    } else {
      appendToBlock(msg)
    }
  }

  flushCurrentBlock()

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
 * True when the tool result spawned sub-agent children. These rows get
 * a dedicated `SubAgentToolCall` card outside the compact pill so live
 * multi-child status (started/running/done) can be tracked. The pill
 * filters them out so the same row isn't shown twice.
 *
 * Keyed off `spawned_sub_task_ids` — the same field the card renders
 * from — rather than the `op` name, so a spawn-like operation added
 * later (`sub_agent_continue`) reaches the card without a change here.
 */
export function isSubAgentToolResult(task: TaskDetail, msg: ChatMessage): boolean {
  if (msg.kind !== 'tool-result') return false
  const callId = msg.entry.tool_call_id
  if (!callId) return false
  const data = toolResultDataByCallId(task).get(callId)
  const ids = data?.spawned_sub_task_ids
  return Array.isArray(ids) && ids.length > 0
}

/**
 * True when the message is a successful `todo` write. The pill renders
 * these as the dedicated 'todo' row kind; failed / rejected writes and
 * non-`write` ops fall through to the generic row surface so the
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

export function formatErrorCode(code: string | null | undefined): string {
  return code?.replace(/_/g, ' ').toLowerCase() ?? ''
}

export function makeInFlightMaps(): {
  perToolApproving: Record<number, boolean>
  perToolRejecting: Record<number, boolean>
} {
  return { perToolApproving: {}, perToolRejecting: {} }
}

export function findToolCallId(
  pending: Array<{ id: number; provider_call_id: string }> | null | undefined,
  providerCallId: string,
): number | undefined {
  return pending?.find((t) => t.provider_call_id === providerCallId)?.id
}

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

export interface LoadedSkillInfo {
  name: string
  bytes: number
}

export function loadedSkillForEntry(task: TaskDetail, entry: ChatMessage): LoadedSkillInfo | null {
  if (entry.kind !== 'tool-result') return null
  if (entry.entry.tool_name !== 'skill') return null
  const tc = toolCallForEntry(task, entry)
  if (!tc) return null
  if (tc.status === 'FAILED' || tc.status === 'REJECTED') return null
  const args = (tc.approved_arguments ?? tc.proposed_arguments) as Record<string, unknown> | null
  if (!args) return null
  if (args.action !== 'read') return null
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
