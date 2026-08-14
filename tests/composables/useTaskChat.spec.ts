/**
 * useTaskChat — pure helpers for TaskChatPage.
 *
 * These helpers stay pure (no Vue lifecycle, no DOM access) so we can test
 * them with plain inputs / outputs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  RETRYABLE_ERROR_CODES,
  NON_RETRYABLE_ERROR_CODES,
  formatCountdown,
  truncateText,
  isTruncated,
  computeRetryState,
  buildChatMessages,
  findFinalReasoning,
  formatErrorCode,
  makeInFlightMaps,
  findToolCallId,
  parseSystemMarker,
} from '@/composables/useTaskChat'
import type { HistoryEntry } from '@/types/task'

describe('useTaskChat helpers', () => {
  describe('error-code lists', () => {
    it('exposes the retryable error codes', () => {
      expect(RETRYABLE_ERROR_CODES).toContain('RATE_LIMIT')
      expect(RETRYABLE_ERROR_CODES).toContain('SERVER_ERROR')
    })

    it('exposes the non-retryable error codes', () => {
      expect(NON_RETRYABLE_ERROR_CODES).toContain('NO_LLM_CONFIGURATION')
      expect(NON_RETRYABLE_ERROR_CODES).toContain('UNKNOWN')
    })
  })

  describe('formatCountdown', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns empty string for null/undefined input', () => {
      expect(formatCountdown(null)).toBe('')
      expect(formatCountdown(undefined)).toBe('')
    })

    it('returns "0:00" when the timestamp is in the past', () => {
      expect(formatCountdown('2025-01-01T00:00:00Z')).toBe('0:00')
    })

    it('formats the ms-until-retry as "m:ss"', () => {
      // 2 minutes 30 seconds in the future
      const target = new Date('2026-01-01T00:02:30Z').toISOString()
      expect(formatCountdown(target)).toBe('2:30')
    })

    it('zero-pads seconds < 10', () => {
      const target = new Date('2026-01-01T00:00:05Z').toISOString()
      expect(formatCountdown(target)).toBe('0:05')
    })
  })

  describe('truncateText', () => {
    it('returns "(empty)" for null', () => {
      expect(truncateText(null)).toBe('(empty)')
    })

    it('returns the text unchanged when shorter than max', () => {
      expect(truncateText('hi')).toBe('hi')
    })

    it('truncates and adds an ellipsis when longer than max', () => {
      const long = 'x'.repeat(400)
      const out = truncateText(long)
      expect(out.length).toBe(301)
      expect(out.endsWith('…')).toBe(true)
    })

    it('supports a custom max', () => {
      expect(truncateText('hello', 3)).toBe('hel…')
    })
  })

  describe('isTruncated', () => {
    it('returns false for null', () => {
      expect(isTruncated(null)).toBe(false)
    })

    it('returns false when below max', () => {
      expect(isTruncated('hi', 5)).toBe(false)
    })

    it('returns true when over max', () => {
      expect(isTruncated('xxxxxx', 5)).toBe(true)
    })
  })

  describe('computeRetryState', () => {
    it('marks a retry task when retry_of_task_id is set', () => {
      const s = computeRetryState(7, 3, 1)
      expect(s.isRetryTask).toBe(true)
      expect(s.autoRetryConfigured).toBe(false) // retry tasks themselves never auto-retry
    })

    it('reports autoRetryConfigured when max_retries > 0 and not a retry task', () => {
      const s = computeRetryState(null, 3, 0)
      expect(s.autoRetryConfigured).toBe(true)
      expect(s.maxRetryAttempts).toBe(3)
    })

    it('canAutoRetry true while attempts remain', () => {
      const s = computeRetryState(null, 3, 1)
      expect(s.canAutoRetry).toBe(true)
      expect(s.retriesExhausted).toBe(false)
      expect(s.retryAttempt).toBe(2) // 1-indexed
    })

    it('retriesExhausted true when retry_count >= max_retries', () => {
      const s = computeRetryState(null, 2, 2)
      expect(s.canAutoRetry).toBe(false)
      expect(s.retriesExhausted).toBe(true)
    })

    it('autoRetryDisabled true when max_retries is 0 and not a retry task', () => {
      const s = computeRetryState(null, 0, null)
      expect(s.autoRetryDisabled).toBe(true)
    })

    it('handles null/undefined inputs', () => {
      const s = computeRetryState(undefined, undefined, undefined)
      expect(s.isRetryTask).toBe(false)
      expect(s.maxRetryAttempts).toBe(0)
      expect(s.retryAttempt).toBe(1)
    })
  })

  describe('buildChatMessages', () => {
    const userEntry: HistoryEntry = { sequence: 0, role: 'user', content: 'Hi', tool_call_id: null, tool_name: null }
    const assistantEntry: HistoryEntry = { sequence: 1, role: 'assistant', content: 'Hello', tool_call_id: null, tool_name: null }
    const toolEntry: HistoryEntry = { sequence: 2, role: 'tool', content: 'result', tool_call_id: 'c1', tool_name: 't' }

    it('returns [] when history is null/undefined', () => {
      expect(buildChatMessages(null, null)).toEqual([])
      expect(buildChatMessages(undefined, null)).toEqual([])
    })

    it('maps user/assistant/tool roles', () => {
      const out = buildChatMessages([userEntry, assistantEntry, toolEntry], null)
      expect(out).toHaveLength(3)
      expect(out[0].kind).toBe('user')
      expect(out[1].kind).toBe('assistant')
      expect(out[2].kind).toBe('tool-result')
    })

    it('skips assistant entries with no content blocks or text content', () => {
      const empty: HistoryEntry = { ...assistantEntry, content: null }
      const out = buildChatMessages([userEntry, empty], null)
      expect(out).toHaveLength(1)
      expect(out[0].kind).toBe('user')
    })

    it('drops the trailing assistant message when it matches finalResponse', () => {
      const out = buildChatMessages([userEntry, assistantEntry], 'Hello')
      expect(out).toHaveLength(1)
      expect(out[0].kind).toBe('user')
    })

    it('keeps the trailing assistant when it does not match finalResponse', () => {
      const out = buildChatMessages([userEntry, assistantEntry], 'Different')
      expect(out).toHaveLength(2)
    })

    it('collapses duplicate tool-result entries with the same tool_call_id (keeps the latest)', () => {
      // sub_agent writes two `role: tool` rows per call: an immediate
      // placeholder ("Sub-agent task #N starts…") and a later resume
      // payload ("Sub-agent task #N completed: …"). The chat UI must
      // render only the resume payload.
      const starts: HistoryEntry = {
        sequence: 2,
        role: 'tool',
        content: 'Sub-agent task #15 starts on agent #1. [Task #15](/tasks/15).',
        tool_call_id: 'pc_sub',
        tool_name: 'handover',
      }
      const completes: HistoryEntry = {
        sequence: 5,
        role: 'tool',
        content: 'Sub-agent task #15 completed:\n\nFull result.',
        tool_call_id: 'pc_sub',
        tool_name: 'handover',
      }
      const out = buildChatMessages([userEntry, assistantEntry, starts, completes], null)
      const toolResults = out.filter((m) => m.kind === 'tool-result')
      expect(toolResults).toHaveLength(1)
      expect((toolResults[0] as { entry: HistoryEntry }).entry.content).toBe(
        'Sub-agent task #15 completed:\n\nFull result.',
      )
      expect((toolResults[0] as { entry: HistoryEntry }).entry.sequence).toBe(5)
    })

    it('does not collapse tool-result entries that belong to different calls', () => {
      const toolA: HistoryEntry = { sequence: 2, role: 'tool', content: 'A', tool_call_id: 'pc_a', tool_name: 't' }
      const toolB: HistoryEntry = { sequence: 3, role: 'tool', content: 'B', tool_call_id: 'pc_b', tool_name: 't' }
      const out = buildChatMessages([userEntry, toolA, toolB], null)
      expect(out.filter((m) => m.kind === 'tool-result')).toHaveLength(2)
    })

    it('does not collapse tool-result entries without a tool_call_id (orphan rows)', () => {
      const orphan1: HistoryEntry = { sequence: 2, role: 'tool', content: 'A', tool_call_id: null, tool_name: 't' }
      const orphan2: HistoryEntry = { sequence: 3, role: 'tool', content: 'B', tool_call_id: null, tool_name: 't' }
      const out = buildChatMessages([userEntry, orphan1, orphan2], null)
      expect(out.filter((m) => m.kind === 'tool-result')).toHaveLength(2)
    })
  })

  describe('findFinalReasoning', () => {
    const assistantWithThinking: HistoryEntry = {
      sequence: 1,
      role: 'assistant',
      content: 'Answer',
      content_blocks: [
        { type: 'thinking', text: 'Because I thought about it' },
      ],
      tool_call_id: null,
      tool_name: null,
    }

    it('returns null with empty inputs', () => {
      expect(findFinalReasoning(null, null)).toBeNull()
      expect(findFinalReasoning([], 'x')).toBeNull()
      expect(findFinalReasoning([assistantWithThinking], null)).toBeNull()
    })

    it('returns thinking text when the last entry matches the final response', () => {
      expect(findFinalReasoning([assistantWithThinking], 'Answer')).toBe(
        'Because I thought about it',
      )
    })

    it('returns null when the matching entry has no thinking block', () => {
      const assistantWithoutThinking: HistoryEntry = {
        ...assistantWithThinking,
        content_blocks: null,
      }
      expect(findFinalReasoning([assistantWithoutThinking], 'Answer')).toBeNull()
    })

    it('returns null when the only reasoning block is redacted', () => {
      const assistantWithRedactedThinking: HistoryEntry = {
        ...assistantWithThinking,
        content_blocks: [{ type: 'redacted_thinking' }],
      }
      expect(findFinalReasoning([assistantWithRedactedThinking], 'Answer')).toBeNull()
    })

    it('returns null when content does not match the final response', () => {
      expect(findFinalReasoning([assistantWithThinking], 'Something else')).toBeNull()
    })
  })

  describe('formatErrorCode', () => {
    it('lowercases and underscores → spaces', () => {
      expect(formatErrorCode('RATE_LIMIT')).toBe('rate limit')
    })

    it('returns empty string for null/undefined', () => {
      expect(formatErrorCode(null)).toBe('')
      expect(formatErrorCode(undefined)).toBe('')
    })
  })

  describe('makeInFlightMaps', () => {
    it('returns two empty record maps', () => {
      const m = makeInFlightMaps()
      expect(m).toEqual({ perToolApproving: {}, perToolRejecting: {} })
    })
  })

  describe('findToolCallId', () => {
    const pending = [
      { id: 1, provider_call_id: 'pc-1' },
      { id: 2, provider_call_id: 'pc-2' },
    ]

    it('finds the tool call id by provider_call_id', () => {
      expect(findToolCallId(pending, 'pc-2')).toBe(2)
    })

    it('returns undefined for unknown id', () => {
      expect(findToolCallId(pending, 'pc-99')).toBeUndefined()
    })

    it('returns undefined for null pending', () => {
      expect(findToolCallId(null, 'pc-1')).toBeUndefined()
    })
  })
})

describe('parseSystemMarker', () => {
  function systemEntry(content: string | null, role: 'system' | 'user' = 'system') {
    return {
      sequence: 1,
      role,
      content,
      tool_call_id: null,
      tool_name: null,
    } as never
  }

  it('returns null when the entry role is not system', () => {
    expect(parseSystemMarker(systemEntry('{"kind":"abort_marker","at":"2026-08-08T12:00:00Z"}', 'user'))).toBeNull()
  })

  it('returns null when content is null', () => {
    expect(parseSystemMarker(systemEntry(null))).toBeNull()
  })

  it('returns null when content is unparseable JSON', () => {
    expect(parseSystemMarker(systemEntry('not-json'))).toBeNull()
  })

  it('returns null when kind is missing', () => {
    expect(parseSystemMarker(systemEntry('{"at":"2026-08-08T12:00:00Z"}'))).toBeNull()
  })

  it('returns null when kind is not a string', () => {
    expect(parseSystemMarker(systemEntry('{"kind":123,"at":"2026-08-08T12:00:00Z"}'))).toBeNull()
  })

  it('returns null for an unknown kind value (defensive — only abort_marker is implemented)', () => {
    expect(parseSystemMarker(systemEntry('{"kind":"future_marker","at":"2026-08-08T12:00:00Z"}'))).toBeNull()
  })

  it('returns null when an abort_marker is missing the required at field', () => {
    expect(parseSystemMarker(systemEntry('{"kind":"abort_marker"}'))).toBeNull()
  })

  it('returns null when an abort_marker at field is not a string', () => {
    expect(parseSystemMarker(systemEntry('{"kind":"abort_marker","at":42}'))).toBeNull()
  })

  it('returns a parseSystemMarker for a valid abort_marker', () => {
    const parsed = parseSystemMarker(systemEntry('{"kind":"abort_marker","at":"2026-08-08T12:00:00Z"}'))
    expect(parsed).toEqual({ kind: 'abort_marker', at: '2026-08-08T12:00:00Z' })
  })
})

describe('buildChatMessages (abort_marker integration)', () => {
  function historyEntry(overrides: Record<string, unknown> = {}) {
    return {
      sequence: 1,
      role: 'user' as const,
      content: null,
      tool_call_id: null,
      tool_name: null,
      content_blocks: null,
      ...overrides,
    } as never
  }

  it('includes abort_marker rows in the chat as system-marker messages', () => {
    const history = [
      historyEntry({ sequence: 1, role: 'user', content: 'first message' }),
      historyEntry({ sequence: 2, role: 'system', content: JSON.stringify({ kind: 'abort_marker', at: '2026-08-08T12:00:00Z' }) }),
      historyEntry({ sequence: 3, role: 'user', content: 'after abort' }),
    ] as never
    const messages = buildChatMessages(history, null)
    expect(messages.some((m) => m.kind === 'system-marker')).toBe(true)
  })

  it('drops malformed system rows silently (no error, no marker message)', () => {
    const history = [
      historyEntry({ sequence: 1, role: 'user', content: 'first' }),
      historyEntry({ sequence: 2, role: 'system', content: 'malformed-json' }),
    ] as never
    const messages = buildChatMessages(history, null)
    expect(messages.some((m) => m.kind === 'system-marker')).toBe(false)
    // The user row above is preserved.
    expect(messages.some((m) => m.kind === 'user' && m.entry.content === 'first')).toBe(true)
  })
})
