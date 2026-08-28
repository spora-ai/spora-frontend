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
    const tickResult = h.port.messages.find((m) => m.type === 'tick-result') as { ok: boolean; status: number; errorCode: string } | undefined
    expect(tickResult?.ok).toBe(false)
    expect(tickResult?.status).toBe(409)
    expect(tickResult?.errorCode).toBe('TICK_ALREADY_RUNNING')
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
})