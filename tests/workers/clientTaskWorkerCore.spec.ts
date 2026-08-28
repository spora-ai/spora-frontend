import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createClientWorkerCore,
  type ClientWorkerCoreOptions,
  type InMsg,
  type OutMsg,
} from '@/workers/clientTaskWorkerCore'

interface Harness {
  core: ReturnType<typeof createClientWorkerCore>
  fetch: ReturnType<typeof vi.fn>
  port: { postMessage: ReturnType<typeof vi.fn>; messages: OutMsg[] }
  schedule: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}

function createHarness(): Harness {
  const fetchMock = vi.fn()
  const messages: OutMsg[] = []
  const postMessage = vi.fn((msg: OutMsg) => { messages.push(msg) })
  // The harness routes `setTimeout` through the global (faked) timer so
  // `vi.advanceTimersByTime()` can drive the tick + housekeeping loops.
  // The mock still records the calls so we can assert on the intervals.
  const schedule = vi.fn((cb: () => void, ms: number) => setTimeout(cb, ms))
  const cancel = vi.fn((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const opts: ClientWorkerCoreOptions = {
    fetch: fetchMock as unknown as typeof fetch,
    port: { postMessage },
    setTimeout: schedule as unknown as ClientWorkerCoreOptions['setTimeout'],
    clearTimeout: cancel as unknown as ClientWorkerCoreOptions['clearTimeout'],
    now: () => Date.now(),
  }
  const core = createClientWorkerCore(opts)
  return { core, fetch: fetchMock, port: { postMessage, messages }, schedule, cancel }
}

const INIT: InMsg = {
  type: 'init',
  userId: 1,
  csrfToken: 'csrf-test',
  tickEndpoint: '/api/v1/tasks/{taskId}/tick',
  housekeepingEndpoint: '/api/v1/worker/housekeeping',
  tickIntervalMs: 2000,
  housekeepingIntervalSeconds: 300,
  tickLeaseSeconds: 600,
  baseUrl: 'https://example.test',
}

describe('clientTaskWorkerCore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits status: active after init and starts the tick + housekeeping timers', () => {
    const h = createHarness()
    h.core.handle(INIT)

    // First post is the boot status message.
    expect(h.port.messages[0]).toMatchObject({ type: 'status', status: 'active', drivenTaskCount: 0 })
    // Two intervals scheduled — one for ticks, one for housekeeping.
    expect(h.schedule).toHaveBeenCalledTimes(2)
    expect(h.schedule.mock.calls[0]?.[1]).toBe(2000)
    expect(h.schedule.mock.calls[1]?.[1]).toBe(300_000)
  })

  it('calls POST /tick with the templated taskId, csrf header, and lease owner on the tick interval', async () => {
    const h = createHarness()
    h.core.handle(INIT)
    h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })

    h.fetch.mockResolvedValueOnce(new Response('{}', { status: 200 }))

    // Advance past the tick interval — the tickOnce loop awaits fetch,
    // so we need runOnlyPendingTimersAsync() to flush the microtask.
    await vi.advanceTimersByTimeAsync(2000)

    expect(h.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = h.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.test/api/v1/tasks/42/tick')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-test')
    expect((init.headers as Record<string, string>)['X-Tick-Lease-Owner']).toBe('user:1')
    expect(init.credentials).toBe('include')

    const tickResult = h.port.messages.find((m) => m.type === 'tick-result')
    expect(tickResult).toMatchObject({ type: 'tick-result', taskId: 42, ok: true, status: 200 })
  })

  it('forwards the taskResource body in tick-result on a 2xx JSON response', async () => {
    const h = createHarness()
    h.core.handle(INIT)
    h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })

    const task = { id: 42, status: 'RUNNING', step_count: 1, tool_calls: [], history: [{ sequence: 1 }] }
    h.fetch.mockResolvedValueOnce(new Response(
      JSON.stringify({ data: { task } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    await vi.advanceTimersByTimeAsync(2000)

    const tickResult = h.port.messages.find((m) => m.type === 'tick-result') as
      { task?: unknown; ok: boolean } | undefined
    expect(tickResult?.ok).toBe(true)
    expect(tickResult?.task).toEqual(task)
  })

  it('omits the task field in tick-result when the 2xx body is not JSON', async () => {
    const h = createHarness()
    h.core.handle(INIT)
    h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })

    h.fetch.mockResolvedValueOnce(new Response('OK', { status: 200 }))

    await vi.advanceTimersByTimeAsync(2000)

    const tickResult = h.port.messages.find((m) => m.type === 'tick-result') as
      { task?: unknown; ok: boolean } | undefined
    expect(tickResult?.ok).toBe(true)
    expect(tickResult?.task).toBeUndefined()
  })

  it('drops the task on a 409 (TICK_LOST_RACE) and posts a tick-result', async () => {
    const h = createHarness()
    h.core.handle(INIT)
    h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })

    h.fetch.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { code: 'TICK_ALREADY_RUNNING', message: 'lost' } }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    ))

    await vi.advanceTimersByTimeAsync(2000)

    expect(h.core.getDrivenTasks()).toEqual([])
    const tickResult = h.port.messages.find((m) => m.type === 'tick-result') as { ok: boolean; status: number; errorCode: string; task?: unknown } | undefined
    expect(tickResult?.ok).toBe(false)
    expect(tickResult?.status).toBe(409)
    expect(tickResult?.errorCode).toBe('TICK_ALREADY_RUNNING')
    expect(tickResult?.task).toBeUndefined()
  })

  it('keeps the task on a network error so the next interval retries', async () => {
    const h = createHarness()
    h.core.handle(INIT)
    h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })

    h.fetch.mockRejectedValueOnce(new TypeError('network down'))

    await vi.advanceTimersByTimeAsync(2000)

    expect(h.core.getDrivenTasks()).toEqual([{ taskId: 42, leaseOwner: 'user:1' }])
  })

  it('drop-task removes the task from drivenTasks and no longer ticks it', async () => {
    const h = createHarness()
    h.core.handle(INIT)
    h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })
    h.core.handle({ type: 'drop-task', taskId: 42 })

    expect(h.core.getDrivenTasks()).toEqual([])

    await vi.advanceTimersByTimeAsync(2000)
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('fires housekeeping on its interval and silently retries on 429', async () => {
    const h = createHarness()
    h.core.handle(INIT)

    h.fetch.mockResolvedValueOnce(new Response('{}', { status: 429 }))

    await vi.advanceTimersByTimeAsync(300_000)

    expect(h.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = h.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.test/api/v1/worker/housekeeping')
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-test')
  })

  it('shutdown clears all timers and driven tasks', () => {
    const h = createHarness()
    h.core.handle(INIT)
    h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })

    h.core.handle({ type: 'shutdown' })

    expect(h.cancel).toHaveBeenCalled()
    expect(h.core.getDrivenTasks()).toEqual([])
    expect(h.port.messages.some((m) => m.type === 'status' && m.status === 'idle')).toBe(true)
  })

  it('ignores a re-consider from the same leaseOwner without churning the status', () => {
    const h = createHarness()
    h.core.handle(INIT)
    const beforeCount = h.port.messages.length
    h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })
    const afterFirst = h.port.messages.length
    h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })
    // The second consider with the same leaseOwner must not post another
    // status message — the worker is still driving the same task.
    expect(h.port.messages.length).toBe(afterFirst)
    expect(h.port.messages.length).toBeGreaterThan(beforeCount)
    expect(h.core.getDrivenTasks()).toEqual([{ taskId: 42, leaseOwner: 'user:1' }])
  })

  it('keeps the task and reports the status on a non-409 error so the transient can pass', async () => {
    const h = createHarness()
    h.core.handle(INIT)
    h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })

    h.fetch.mockResolvedValueOnce(new Response('boom', { status: 500 }))

    await vi.advanceTimersByTimeAsync(2000)

    // 5xx is transient — the server still owns the lease, so dropping the
    // task locally would strand it until the user re-considered.
    expect(h.core.getDrivenTasks()).toEqual([{ taskId: 42, leaseOwner: 'user:1' }])
    const tickResult = h.port.messages.find((m) => m.type === 'tick-result') as
      { ok: boolean; status: number; errorCode: string | null; task?: unknown } | undefined
    expect(tickResult?.ok).toBe(false)
    expect(tickResult?.status).toBe(500)
    expect(tickResult?.errorCode).toBeNull()
    expect(tickResult?.task).toBeUndefined()
  })

  it('falls back to TICK_LOST_RACE when the 409 body is not JSON', async () => {
    const h = createHarness()
    h.core.handle(INIT)
    h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })

    h.fetch.mockResolvedValueOnce(new Response('<html>gateway</html>', { status: 409 }))

    await vi.advanceTimersByTimeAsync(2000)

    expect(h.core.getDrivenTasks()).toEqual([])
    const tickResult = h.port.messages.find((m) => m.type === 'tick-result') as
      { errorCode: string } | undefined
    expect(tickResult?.errorCode).toBe('TICK_LOST_RACE')
  })

  it('ignores a second init so a reconnecting tab cannot double-start the timers', () => {
    const h = createHarness()
    h.core.handle(INIT)
    h.core.handle(INIT)

    // Still only the two timers from the first init.
    expect(h.schedule).toHaveBeenCalledTimes(2)
  })

  it('starts no timers when the configured intervals are zero', () => {
    const h = createHarness()
    h.core.handle({ ...INIT, tickIntervalMs: 0, housekeepingIntervalSeconds: 0 } as InMsg)

    expect(h.schedule).not.toHaveBeenCalled()
    expect(h.port.messages[0]).toMatchObject({ type: 'status', status: 'active' })
  })

  it('shutdown before init is a no-op that still reports idle', () => {
    const h = createHarness()
    h.core.handle({ type: 'shutdown' })

    expect(h.cancel).not.toHaveBeenCalled()
    expect(h.port.messages[0]).toMatchObject({ type: 'status', status: 'idle' })
  })

  it('drop-task for a task it never drove does not post a status', () => {
    const h = createHarness()
    h.core.handle(INIT)
    const before = h.port.messages.length

    h.core.handle({ type: 'drop-task', taskId: 999 })

    expect(h.port.messages.length).toBe(before)
  })

  it('completes housekeeping on a 2xx without dropping the loop', async () => {
    const h = createHarness()
    h.core.handle(INIT)

    h.fetch.mockResolvedValueOnce(new Response('{}', { status: 200 }))

    await vi.advanceTimersByTimeAsync(300_000)

    expect(h.fetch).toHaveBeenCalledTimes(1)
    // Housekeeping is fire-and-forget — it must not emit tick-results.
    expect(h.port.messages.some((m) => m.type === 'tick-result')).toBe(false)
  })

  it('swallows a housekeeping network error so the next interval retries', async () => {
    const h = createHarness()
    h.core.handle(INIT)

    h.fetch.mockRejectedValueOnce(new TypeError('network down'))

    await expect(vi.advanceTimersByTimeAsync(300_000)).resolves.not.toThrow()
    expect(h.fetch).toHaveBeenCalledTimes(1)
  })

  describe('console logging', () => {
    let infoSpy: ReturnType<typeof vi.spyOn>
    let warnSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      infoSpy.mockRestore()
      warnSpy.mockRestore()
    })

    it('logs "Bootstrapping" on init and "Worker offline" on shutdown', () => {
      const h = createHarness()
      h.core.handle(INIT)
      h.core.handle({ type: 'shutdown' })

      const messages = infoSpy.mock.calls.map((c) => String(c[0]))
      expect(messages.some((m) => m.includes('Bootstrapping') && m.includes('userId=1'))).toBe(true)
      expect(messages.some((m) => m.includes('Worker offline'))).toBe(true)
    })

    it('logs "Considering task N" when a new task enters drivenTasks', () => {
      const h = createHarness()
      h.core.handle(INIT)
      infoSpy.mockClear()
      h.core.handle({ type: 'consider-task', taskId: 99, leaseOwner: 'user:1' })
      expect(infoSpy.mock.calls.some((c) => String(c[0]).includes('Considering task 99'))).toBe(true)
    })

    it('logs "Processing task N" + a completion line on a successful 2xx tick', async () => {
      const h = createHarness()
      h.core.handle(INIT)
      h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })
      infoSpy.mockClear()

      h.fetch.mockResolvedValueOnce(new Response(
        JSON.stringify({ data: { task: { id: 42, status: 'COMPLETED', step_count: 2 } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))

      await vi.advanceTimersByTimeAsync(2000)

      const messages = infoSpy.mock.calls.map((c) => String(c[0]))
      expect(messages.some((m) => m.includes('Processing task 42'))).toBe(true)
      expect(messages.some((m) => m.includes('Task 42 tick completed') && m.includes('COMPLETED') && m.includes('steps: 2'))).toBe(true)
    })

    it('logs a warn line on a 409 TICK_LOST_RACE and on a 5xx', async () => {
      const h = createHarness()
      h.core.handle(INIT)
      h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })
      warnSpy.mockClear()

      h.fetch.mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { code: 'TICK_ALREADY_RUNNING', message: 'lost' } }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ))
      await vi.advanceTimersByTimeAsync(2000)
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('lost race'))).toBe(true)

      // Re-consider and trigger a 5xx
      h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })
      warnSpy.mockClear()
      h.fetch.mockResolvedValueOnce(new Response('boom', { status: 500 }))
      await vi.advanceTimersByTimeAsync(2000)
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('HTTP 500'))).toBe(true)
    })

    it('logs a warn line on a network error', async () => {
      const h = createHarness()
      h.core.handle(INIT)
      h.core.handle({ type: 'consider-task', taskId: 42, leaseOwner: 'user:1' })
      warnSpy.mockClear()

      h.fetch.mockRejectedValueOnce(new TypeError('network down'))
      await vi.advanceTimersByTimeAsync(2000)

      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('network error') && String(c[0]).includes('network down'))).toBe(true)
    })

    it('silences the logs when localStorage[spora-client-worker-debug] === "0"', () => {
      const previous = (globalThis as { localStorage?: Storage }).localStorage
      const store: Record<string, string> = {}
      ;(globalThis as { localStorage: Storage }).localStorage = {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v },
        removeItem: (k: string) => { delete store[k] },
        clear: () => { for (const k of Object.keys(store)) delete store[k] },
        key: () => null,
        get length() { return Object.keys(store).length },
      } as Storage
      store['spora-client-worker-debug'] = '0'

      try {
        const h = createHarness()
        h.core.handle(INIT)
        expect(infoSpy).not.toHaveBeenCalled()
      } finally {
        if (previous === undefined) {
          delete (globalThis as { localStorage?: Storage }).localStorage
        } else {
          ;(globalThis as { localStorage: Storage }).localStorage = previous
        }
      }
    })
  })
})