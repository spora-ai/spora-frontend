import { describe, it, expect, vi } from 'vitest'

/**
 * useRealtime integration tests.
 *
 * The useRealtime composable uses a module-level singleton for the EventSource
 * connection, which makes it challenging to test in isolation without modifying
 * production code. These tests verify the SSE-active path.
 *
 * The topic structure (user/{userId}/tasks, user/{userId}/notifications) is validated by:
 *   - SseControllerTest (subscriber JWT claims)
 *   - MercurePublisherTest (publish topic format)
 *   - tasks.spec.ts applyTaskUpdate tests (SSE data handling)
 *
 * The onmessage handler tests below use a per-test EventSource shim that
 * captures the handler so we can drive malformed/missing-payload messages
 * through it without depending on a real network.
 */

const prependFromSSE = vi.fn()
const applyTaskUpdate = vi.fn()
const applySseEventToTasks = vi.fn()
const applySseTaskEvent = vi.fn()
const startDashboardPolling = vi.fn()
const stopDashboardPolling = vi.fn()
const startNotificationPolling = vi.fn()
const stopNotificationPolling = vi.fn()
// The real fetchNotifications is declared async (returns Promise<void>),
// so the production code chains .catch() on its return value. A bare
// `vi.fn()` returns undefined and would crash that chain — give the mock
// a resolved-promise default so consumers can await / chain safely.
const fetchNotificationsInNotificationsStore = vi.fn().mockResolvedValue(undefined)

vi.mock('@/api/client', () => ({
  api: { get: vi.fn() },
}))

vi.mock('@/stores/notifications', () => ({
  useNotificationStore: () => ({
    prependFromSSE,
    fetchNotifications: fetchNotificationsInNotificationsStore,
    startNotificationPolling,
    stopNotificationPolling,
  }),
}))

vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => ({
    applyTaskUpdate,
    applySseEventToTasks,
    startDashboardPolling,
    stopDashboardPolling,
  }),
}))

vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({ applySseTaskEvent }),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: { id: 1, email: 'test@example.com' }, initialized: true }),
}))

import { api } from '@/api/client'

describe('useRealtime integration', () => {
  it('calls /sse/auth when SSE is active', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', token: 'test-token' })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    expect(api.get).toHaveBeenCalledWith('/sse/auth')
  })

  it('does not start polling when SSE is active', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', token: 'test-token' })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    expect(startDashboardPolling).not.toHaveBeenCalled()
  })

  it('calls fetchNotifications once when SSE is inactive (polling fallback)', async () => {
    vi.clearAllMocks()
    // /sse/status reports inactive → useRealtime falls back to polling.
    vi.mocked(api).get.mockResolvedValueOnce({ active: false })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    // The polling fallback must bootstrap the badge by calling
    // fetchNotifications immediately, mirroring the SSE success path.
    expect(fetchNotificationsInNotificationsStore).toHaveBeenCalledTimes(1)
  })

  it('starts dashboard polling on fallback when no options are passed', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get.mockResolvedValueOnce({ active: false })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    expect(startDashboardPolling).toHaveBeenCalledTimes(1)
    // Notification polling is independent of the dashboard opt-out and
    // must always start so the navbar bell can update.
    expect(startNotificationPolling).toHaveBeenCalledTimes(1)
  })

  it('starts dashboard polling on fallback when skipDashboardPolling is false', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get.mockResolvedValueOnce({ active: false })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime({ skipDashboardPolling: false })
    await new Promise(r => setTimeout(r, 0))

    expect(startDashboardPolling).toHaveBeenCalledTimes(1)
    expect(startNotificationPolling).toHaveBeenCalledTimes(1)
  })
})

// Tests for the `skipDashboardPolling` opt-out. The dashboard page wants
// SSE updates without an auto-polling tick — only manual refresh should
// refetch tasks. Notification polling stays on so the navbar bell keeps
// updating. These tests assert the gate inside `startPollingFallback` is
// honored when SSE is unavailable.
describe('useRealtime skipDashboardPolling option', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips dashboard polling on fallback when skipDashboardPolling is true', async () => {
    vi.mocked(api).get.mockResolvedValueOnce({ active: false })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime({ skipDashboardPolling: true })
    await new Promise(r => setTimeout(r, 0))

    expect(startDashboardPolling).not.toHaveBeenCalled()
    // Notification polling is intentionally NOT gated.
    expect(startNotificationPolling).toHaveBeenCalledTimes(1)
  })

  it('skips dashboard polling on fallback when SSE errors out mid-connection', async () => {
    // Simulate SSE going active, then triggering onerror — the production
    // path also calls startPollingFallback from EventSource.onerror.
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', token: 't' })

    let capturedOnError: (() => void) | null = null
    const originalEventSource = (globalThis as unknown as { EventSource: typeof EventSource }).EventSource
    class CapturingEventSource {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSED = 3
      url: string
      readyState = 0
      onmessage: ((e: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      constructor(url: string) {
        this.url = url
        capturedOnError = () => this.onerror?.()
      }
      close() { this.readyState = 3 }
    }
    ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = CapturingEventSource as unknown as typeof EventSource
    vi.resetModules()
    try {
      const { useRealtime } = await import('@/composables/useRealtime')
      useRealtime({ skipDashboardPolling: true })
      await new Promise(r => setTimeout(r, 0))

      // SSE error → polling fallback fires.
      capturedOnError?.()
      await new Promise(r => setTimeout(r, 0))

      expect(startDashboardPolling).not.toHaveBeenCalled()
      expect(startNotificationPolling).toHaveBeenCalledTimes(1)
    } finally {
      ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = originalEventSource
      vi.resetModules()
    }
  })

  it('still calls fetchNotifications on fallback when skipDashboardPolling is true', async () => {
    vi.mocked(api).get.mockResolvedValueOnce({ active: false })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime({ skipDashboardPolling: true })
    await new Promise(r => setTimeout(r, 0))

    // Badge bootstrap is independent of the dashboard opt-out.
    expect(fetchNotificationsInNotificationsStore).toHaveBeenCalledTimes(1)
  })
})

// SSE message-handler tests. The global EventSource stub in tests/setup.ts
// doesn't expose onmessage, so we install a per-test shim that captures
// the handler so we can feed it malformed JSON / non-user topics and
// confirm the message validator does not crash the SSE listener.
describe('useRealtime SSE onmessage handler', () => {
  let capturedOnMessage: ((event: MessageEvent) => void) | null = null
  let originalEventSource: typeof EventSource

  beforeEach(async () => {
    capturedOnMessage = null
    originalEventSource = (globalThis as unknown as { EventSource: typeof EventSource }).EventSource
    class CapturingEventSource {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSED = 3
      url: string
      // CONNECTING (0) so useRealtime always creates a fresh instance
      // and the captured onmessage setter is the one production code writes.
      readyState = 0
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      constructor(url: string) {
        this.url = url
        capturedOnMessage = (e: MessageEvent) => this.onmessage?.(e)
      }
      close() { this.readyState = 3 }
    }
    ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = CapturingEventSource as unknown as typeof EventSource
    // Reset the module so the module-level `globalEventSource` singleton
    // is nulled between tests — otherwise the second test would reuse
    // the first test's EventSource (which is in OPEN state) and our
    // captured handler would never fire.
    vi.resetModules()
  })

  afterEach(() => {
    ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = originalEventSource
    vi.resetModules()
  })

  it('ignores malformed JSON without throwing', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', token: 't' })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    // Garbage payload — must not crash, must not call any store.
    capturedOnMessage?.({ data: 'not-json {{{' } as MessageEvent)

    expect(applyTaskUpdate).not.toHaveBeenCalled()
    expect(prependFromSSE).not.toHaveBeenCalled()
  })

  it('ignores payloads missing the topic envelope', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', token: 't' })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    capturedOnMessage?.({ data: JSON.stringify({ data: { id: 1 } }) } as MessageEvent)

    expect(applyTaskUpdate).not.toHaveBeenCalled()
    expect(prependFromSSE).not.toHaveBeenCalled()
  })

  it('ignores payloads where data is not an object', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', token: 't' })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    capturedOnMessage?.({ data: JSON.stringify({ topic: 'user/1/tasks', data: 'oops' }) } as MessageEvent)

    expect(applyTaskUpdate).not.toHaveBeenCalled()
    expect(prependFromSSE).not.toHaveBeenCalled()
  })

  it('routes user/{id}/tasks payloads to the task stores', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', token: 't' })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    capturedOnMessage?.({
      data: JSON.stringify({ topic: 'user/1/tasks', data: { task_id: 42, status: 'RUNNING' } }),
    } as MessageEvent)

    expect(applyTaskUpdate).toHaveBeenCalledWith(42, { task_id: 42, status: 'RUNNING' })
  })

  it('routes user/{id}/notifications payloads to the notification store', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', token: 't' })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    const notification = { id: 7, type: 'info', title: 'hi' }
    capturedOnMessage?.({
      data: JSON.stringify({ topic: 'user/1/notifications', data: { notification } }),
    } as MessageEvent)

    expect(prependFromSSE).toHaveBeenCalledWith(notification)
    expect(applyTaskUpdate).not.toHaveBeenCalled()
  })

  it('ignores topics that are not under user/', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', token: 't' })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    capturedOnMessage?.({
      data: JSON.stringify({ topic: 'global/broadcast', data: { id: 1 } }),
    } as MessageEvent)

    expect(applyTaskUpdate).not.toHaveBeenCalled()
    expect(prependFromSSE).not.toHaveBeenCalled()
  })
})
