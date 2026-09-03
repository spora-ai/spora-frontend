import { describe, it, expect, vi, beforeEach } from 'vitest'

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
const fetchNotificationsInNotificationsStore = vi.fn().mockResolvedValue(undefined)
const postConsiderTask = vi.fn()
const postDropTask = vi.fn()

// Shared mutable state for the auth-store mock. The closes-the-previous
// connection test mutates `authState.user` to verify the OPEN fast path
// re-mints the connection on user change.
const authState: {
  user: { id: number; email: string } | null
  initialized: boolean
} = {
  user: { id: 1, email: 'test@example.com' },
  initialized: true,
}

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: { get: vi.fn() },
  }
})

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
  useAuthStore: () => authState,
}))

vi.mock('@/composables/useClientWorker', () => ({
  postConsiderTask,
  postDropTask,
}))

import { api } from '@/api/client'
import { ApiError } from '@/api/client'

describe('useRealtime integration', () => {
  it('calls /sse/authorize when SSE is active', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    expect(api.get).toHaveBeenCalledWith('/sse/authorize')
  })

  it('does not start polling when SSE is active', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    expect(startDashboardPolling).not.toHaveBeenCalled()
  })

  it('falls back to polling when /sse/authorize returns 401', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockRejectedValueOnce(new ApiError('SSE not available', 'UNAUTHENTICATED', 401))

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    expect(startDashboardPolling).toHaveBeenCalledTimes(1)
    expect(startNotificationPolling).toHaveBeenCalledTimes(1)
    expect(fetchNotificationsInNotificationsStore).toHaveBeenCalledTimes(1)
  })

  it('opens the EventSource with withCredentials: true and subscribes to every visible principal topic', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

    // Plan B: the principals store feeds the topic list — one
    // principal/{id}/tasks topic per visible principal + one
    // user/{id}/notifications topic for the bell.
    const { usePrincipalsStore } = await import('@/stores/principals')
    const principalsStore = usePrincipalsStore()
    principalsStore.principals = [
      { id: 1, type: 'user', user_id: 1, group_id: null } as never,
      { id: 13, type: 'group', user_id: null, group_id: 7 } as never,
      { id: 17, type: 'group', user_id: null, group_id: 8 } as never,
    ]

    let capturedEventSource: { withCredentials: boolean; url: string } | null = null
    const originalEventSource = (globalThis as unknown as { EventSource: typeof EventSource }).EventSource
    class CapturingEventSource {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSED = 3
      url: string
      withCredentials: boolean
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((e: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      constructor(url: string, init?: EventSourceInit) {
        this.url = url
        this.withCredentials = init?.withCredentials === true
        capturedEventSource = this
      }
      close() { this.readyState = 3 }
    }
    ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = CapturingEventSource as unknown as typeof EventSource
    vi.resetModules()
    try {
      const { useRealtime } = await import('@/composables/useRealtime')
      useRealtime()
      await new Promise(r => setTimeout(r, 0))

      expect(capturedEventSource).not.toBeNull()
      expect(capturedEventSource?.withCredentials).toBe(true)
      // The URL must carry every principal topic the caller can act as.
      const u = new URL(capturedEventSource!.url)
      const topics = u.searchParams.getAll('topic')
      expect(topics).toContain('principal/1/tasks')
      expect(topics).toContain('principal/13/tasks')
      expect(topics).toContain('principal/17/tasks')
      expect(topics).toContain('user/1/notifications')
    } finally {
      ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = originalEventSource
      vi.resetModules()
    }
  })

  it('re-mints the SSE connection when the visible principal set changes (group join/leave)', async () => {
    // Plan B: principal-keyed topics are baked into the JWT at mint time, so
    // when the user joins/leaves a group the SSE URL must be rebuilt with the
    // new topic list. Without this watcher the user would miss new topics
    // for up to the JWT TTL (~1h).
    vi.clearAllMocks()
    // First connect uses two responses; the reconnect after the group join
    // uses another two. Queue all four up front.
    for (let i = 0; i < 2; i++) {
      vi.mocked(api).get
        .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
        .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })
    }

    const { usePrincipalsStore } = await import('@/stores/principals')
    const principalsStore = usePrincipalsStore()
    principalsStore.principals = [
      { id: 1, type: 'user', user_id: 1, group_id: null } as never,
    ]

    const sources: { url: string; closeCount: number }[] = []
    const originalEventSource = (globalThis as unknown as { EventSource: typeof EventSource }).EventSource
    class TrackedEventSource {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSED = 3
      url: string
      withCredentials = false
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((e: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      constructor(url: string) {
        this.url = url
        const entry = { url, closeCount: 0 }
        sources.push(entry)
        // Bind close() to mutate the entry so the assertion can read it back.
        ;(this as unknown as { _entry: typeof entry })._entry = entry
      }
      close(): void {
        ;(this as unknown as { _entry: { closeCount: number } })._entry.closeCount += 1
        this.readyState = 3
      }
    }
    ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = TrackedEventSource as unknown as typeof EventSource
    vi.resetModules()
    try {
      const { useRealtime } = await import('@/composables/useRealtime')
      useRealtime()
      // Let the first connect resolve (api.get + EventSource).
      await new Promise(r => setTimeout(r, 0))
      await new Promise(r => setTimeout(r, 0))

      const firstSource = sources[0]
      expect(firstSource).toBeDefined()
      const firstUrl = new URL(firstSource.url)
      expect(firstUrl.searchParams.getAll('topic')).toContain('principal/1/tasks')

      // User joins a new group → the visible principal set grows.
      principalsStore.principals = [
        { id: 1, type: 'user', user_id: 1, group_id: null } as never,
        { id: 13, type: 'group', user_id: null, group_id: 7 } as never,
      ]
      // Vue's watch is microtask-deferred; the second connectSse's
      // .finally() then needs another microtask to release the
      // `globalConnectPromise` lock. Subsequent tests would short-circuit
      // if the lock is still held.
      await new Promise(r => setTimeout(r, 0))
      await new Promise(r => setTimeout(r, 0))
      await new Promise(r => setTimeout(r, 0))
      await new Promise(r => setTimeout(r, 0))

      // A second EventSource must have been constructed. The first must
      // have been closed. The new URL must carry the new principal topic.
      expect(sources.length).toBeGreaterThanOrEqual(2)
      expect(firstSource.closeCount).toBe(1)
      const secondSource = sources[sources.length - 1]
      const secondUrl = new URL(secondSource.url)
      expect(secondUrl.searchParams.getAll('topic')).toContain('principal/1/tasks')
      expect(secondUrl.searchParams.getAll('topic')).toContain('principal/13/tasks')
    } finally {
      // Drain the in-flight connectSse() chain (the principal watch's
      // reconnect goes through `void connectSse()` so its `.finally(...)`
      // is detached). Without this the next test's fresh module sees a
      // short-circuited `globalConnectPromise` and the polling-fallback
      // path never runs.
      await new Promise(r => setTimeout(r, 0))
      await new Promise(r => setTimeout(r, 0))
      await new Promise(r => setTimeout(r, 0))
      ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = originalEventSource
      vi.resetModules()
    }
  })

  it('stops polling and marks connected only after EventSource.onopen fires', async () => {
    // Eager setting (in `connect()` directly) would report "connected" while
    // the handshake is still in flight — the UI would briefly think SSE is up
    // and stop polling before the server actually opens the connection.
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

    let capturedEventSource: { onopen: (() => void) | null } | null = null
    const originalEventSource = (globalThis as unknown as { EventSource: typeof EventSource }).EventSource
    class CapturingEventSource {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSED = 3
      url: string
      withCredentials = false
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((e: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      constructor(url: string, init?: EventSourceInit) {
        this.url = url
        this.withCredentials = init?.withCredentials === true
        capturedEventSource = this
      }
      close() { this.readyState = 3 }
    }
    ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = CapturingEventSource as unknown as typeof EventSource
    vi.resetModules()
    try {
      const { useRealtime } = await import('@/composables/useRealtime')
      useRealtime()
      await new Promise(r => setTimeout(r, 0))

      // Handshake complete, EventSource constructed. onopen hasn't fired yet.
      expect(stopDashboardPolling).not.toHaveBeenCalled()
      expect(stopNotificationPolling).not.toHaveBeenCalled()

      // Simulate the server opening the connection.
      capturedEventSource?.onopen?.()
      await new Promise(r => setTimeout(r, 0))

      expect(stopDashboardPolling).toHaveBeenCalledTimes(1)
      expect(stopNotificationPolling).toHaveBeenCalledTimes(1)
    } finally {
      ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = originalEventSource
      vi.resetModules()
    }
  })

  it('reuses an open connection on a second call when the user matches', async () => {
    // The OPEN fast path returns the cached `globalConnected` ref without
    // re-running the handshake. Pinned here so a future refactor that
    // closes + re-mints on every call would fail this test.
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

    let capturedEventSource: { readyState: number } | null = null
    const originalEventSource = (globalThis as unknown as { EventSource: typeof EventSource }).EventSource
    class CapturingEventSource {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSED = 3
      url = ''
      withCredentials = false
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((e: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      constructor(url: string, init?: EventSourceInit) {
        this.url = url
        this.withCredentials = init?.withCredentials === true
        capturedEventSource = this
      }
      close() { this.readyState = 3 }
    }
    ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = CapturingEventSource as unknown as typeof EventSource
    vi.resetModules()
    try {
      const { useRealtime } = await import('@/composables/useRealtime')
      useRealtime()
      await new Promise(r => setTimeout(r, 0))

      expect(capturedEventSource).not.toBeNull()
      // Simulate the server opening the connection.
      capturedEventSource!.readyState = 1

      const callsBefore = vi.mocked(api).get.mock.calls.length
      useRealtime()
      await new Promise(r => setTimeout(r, 0))

      // The OPEN fast path returns early without fetching status again.
      expect(vi.mocked(api).get.mock.calls.length).toBe(callsBefore)
    } finally {
      ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = originalEventSource
      vi.resetModules()
    }
  })

  it('closes the previous connection and re-mints when the user changes', async () => {
    // A stale connection from a previous login would deliver that user's
    // topics to the wrong browser. The OPEN fast path must therefore
    // include the user id in its key, not just the readyState.
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

    const closeSpy = vi.fn()
    const capturedEventSources: Array<EventSource> = []
    const originalEventSource = (globalThis as unknown as { EventSource: typeof EventSource }).EventSource
    class CapturingEventSource {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSED = 3
      url = ''
      withCredentials = false
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((e: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      constructor(url: string, init?: EventSourceInit) {
        this.url = url
        this.withCredentials = init?.withCredentials === true
        capturedEventSources.push(this)
      }
      close() {
        closeSpy()
        this.readyState = 3
      }
    }
    ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = CapturingEventSource as unknown as typeof EventSource
    vi.resetModules()
    try {
      const { useRealtime } = await import('@/composables/useRealtime')
      useRealtime()
      await new Promise(r => setTimeout(r, 0))

      expect(capturedEventSources).toHaveLength(1)
      // Simulate the first connection opening.
      capturedEventSources[0].readyState = 1

      // Switch user — the OPEN fast path must invalidate the connection.
      authState.user = { id: 2, email: 'other@example.com' }
      useRealtime()
      await new Promise(r => setTimeout(r, 0))

      // The previous connection was closed and a new one was constructed.
      expect(capturedEventSources).toHaveLength(2)
      expect(closeSpy).toHaveBeenCalledTimes(1)
    } finally {
      ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = originalEventSource
      vi.resetModules()
    }
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
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

    let capturedOnError: (() => void) | null = null
    const originalEventSource = (globalThis as unknown as { EventSource: typeof EventSource }).EventSource
    class CapturingEventSource {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSED = 3
      url: string
      withCredentials = false
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((e: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      constructor(url: string, init?: EventSourceInit) {
        this.url = url
        this.withCredentials = init?.withCredentials === true
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
      withCredentials = false
      // CONNECTING (0) so useRealtime always creates a fresh instance
      // and the captured onmessage setter is the one production code writes.
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      constructor(url: string, init?: EventSourceInit) {
        this.url = url
        this.withCredentials = init?.withCredentials === true
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
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

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
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

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
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

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
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

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
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

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

  it('ignores topics that are not under user/ or principal/', async () => {
    vi.clearAllMocks()
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    capturedOnMessage?.({
      data: JSON.stringify({ topic: 'global/broadcast', data: { id: 1 } }),
    } as MessageEvent)

    expect(applyTaskUpdate).not.toHaveBeenCalled()
    expect(prependFromSSE).not.toHaveBeenCalled()
  })

  it('routes principal/{id}/tasks payloads to the task stores (group-peer fan-out)', async () => {
    // Plan B: a group-owned task transitions into PENDING_APPROVAL while
    // a group peer (not the trigger user) is viewing the dashboard. The
    // backend publishes to principal/{groupPrincipalId}/tasks; the SPA's
    // SSE handler must accept principal/-prefixed topics and route them
    // through the same task-store update path.
    vi.clearAllMocks()
    authState.user = { id: 1, email: 'test@example.com' }
    authState.initialized = true
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    capturedOnMessage?.({
      data: JSON.stringify({
        topic: 'principal/13/tasks',
        data: { task_id: 42, status: 'PENDING_APPROVAL' },
      }),
    } as MessageEvent)

    expect(applyTaskUpdate).toHaveBeenCalledWith(42, expect.objectContaining({ status: 'PENDING_APPROVAL' }))
    expect(applySseEventToTasks).toHaveBeenCalledWith(expect.objectContaining({ status: 'PENDING_APPROVAL' }))
  })

  // Phase 5 — the SSE forwarder hands off QUEUED / RUNNING tasks to the
  // SharedWorker (so it can drive /tick) and drops terminal / quiescent
  // ones (so it stops driving them).
  it('forwards a RUNNING task update to the client worker via postConsiderTask', async () => {
    vi.clearAllMocks()
    // Earlier tests mutate authState.user (e.g. the closes-the-previous-
    // connection test) — restore the expected id=1 baseline so the
    // leaseOwner string is stable across the suite.
    authState.user = { id: 1, email: 'test@example.com' }
    authState.initialized = true
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    capturedOnMessage?.({
      data: JSON.stringify({ topic: 'user/1/tasks', data: { task_id: 42, status: 'RUNNING' } }),
    } as MessageEvent)

    expect(postConsiderTask).toHaveBeenCalledWith(42, 'user:1')
    expect(postDropTask).not.toHaveBeenCalled()
  })

  it('forwards a QUEUED task update (backend initial state) to the client worker', async () => {
    // The frontend's TaskStatus union does not include QUEUED, but the
    // backend publishes it. The forwarder must accept the wire value
    // verbatim so the SharedWorker starts ticking pre-claim tasks.
    vi.clearAllMocks()
    authState.user = { id: 1, email: 'test@example.com' }
    authState.initialized = true
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    capturedOnMessage?.({
      data: JSON.stringify({ topic: 'user/1/tasks', data: { task_id: 42, status: 'QUEUED' } }),
    } as MessageEvent)

    expect(postConsiderTask).toHaveBeenCalledWith(42, 'user:1')
  })

  it('drops a terminal task (COMPLETED) via postDropTask', async () => {
    vi.clearAllMocks()
    authState.user = { id: 1, email: 'test@example.com' }
    authState.initialized = true
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    capturedOnMessage?.({
      data: JSON.stringify({ topic: 'user/1/tasks', data: { task_id: 42, status: 'COMPLETED' } }),
    } as MessageEvent)

    expect(postDropTask).toHaveBeenCalledWith(42)
    expect(postConsiderTask).not.toHaveBeenCalled()
  })

  it('drops a quiescent task (PENDING_APPROVAL) via postDropTask', async () => {
    // A user just hit "approve" — the task is now waiting on them, not
    // on the worker. The forwarder must tell the worker to stop ticking.
    vi.clearAllMocks()
    authState.user = { id: 1, email: 'test@example.com' }
    authState.initialized = true
    vi.mocked(api).get
      .mockResolvedValueOnce({ active: true, hubUrl: '/.well-known/mercure' })
      .mockResolvedValueOnce({ hubUrl: '/.well-known/mercure', expires: Math.floor(Date.now() / 1000) + 3600 })

    const { useRealtime } = await import('@/composables/useRealtime')
    useRealtime()
    await new Promise(r => setTimeout(r, 0))

    capturedOnMessage?.({
      data: JSON.stringify({ topic: 'user/1/tasks', data: { task_id: 42, status: 'PENDING_APPROVAL' } }),
    } as MessageEvent)

    expect(postDropTask).toHaveBeenCalledWith(42)
  })
})
