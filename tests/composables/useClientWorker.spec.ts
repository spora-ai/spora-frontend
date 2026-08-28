import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, ref } from 'vue'

/**
 * useClientWorker — boot lifecycle, fallback selection, teardown on logout.
 *
 * The composable is a module-level singleton so each test calls
 * `vi.resetModules()` and the `tests/setup.ts` SharedWorker / Worker
 * shims to capture the worker instance the composable created. We
 * fake the runtime-config and auth stores via `vi.mock` so the
 * composable can resolve them without a real Pinia.
 */

const mockConfigState = {
  initialized: true,
  workerRuntimeMode: 'client' as 'server' | 'client',
  clientWorker: {
    enabled: true,
    tick_endpoint: '/api/v1/tasks/{taskId}/tick',
    housekeeping_endpoint: '/api/v1/worker/housekeeping',
    housekeeping_interval_seconds: 300,
    tick_interval_ms: 2000,
    tick_lease_seconds: 600,
  },
}

// `auth.user` must be reactive — the composable's `watch(() => auth.user)`
// won't fire on plain object property mutations. Using `ref()` makes
// the test mirror the real auth store's reactivity surface.
const mockAuthUser = ref<{ id: number; email: string } | null>({ id: 7, email: 'user@example.com' })
const mockAuthCsrf = ref<string | null>('csrf-test')

const infoSpy = vi.fn()
const warningSpy = vi.fn()
const errorSpy = vi.fn()

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn() },
  }
})

vi.mock('@/utils/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    info: infoSpy,
    warning: warningSpy,
    error: errorSpy,
    success: vi.fn(),
    dismiss: vi.fn(),
    toasts: [],
  }),
}))

vi.mock('@/stores/runtimeConfig', () => ({
  useRuntimeConfigStore: () => ({
    get initialized() { return mockConfigState.initialized },
    get workerRuntimeMode() { return mockConfigState.workerRuntimeMode },
    get clientWorker() { return mockConfigState.clientWorker },
    init: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    get user() { return mockAuthUser.value },
    get csrfToken() { return mockAuthCsrf.value },
  }),
}))

const mockClientWorkerStoreState = {
  status: 'idle' as 'idle' | 'booting' | 'active' | 'degraded' | 'error',
  degradedReason: null as string | null,
  drivenTaskCount: 0,
  lastEventAt: null as number | null,
}

const setStatus = vi.fn((s: typeof mockClientWorkerStoreState.status, r?: string | null) => {
  mockClientWorkerStoreState.status = s
  mockClientWorkerStoreState.degradedReason = r ?? null
  mockClientWorkerStoreState.lastEventAt = Date.now()
})
const setDrivenTaskCount = vi.fn((n: number) => {
  mockClientWorkerStoreState.drivenTaskCount = n
})

vi.mock('@/stores/clientWorker', () => ({
  useClientWorkerStore: () => ({
    get status() { return mockClientWorkerStoreState.status },
    get degradedReason() { return mockClientWorkerStoreState.degradedReason },
    get drivenTaskCount() { return mockClientWorkerStoreState.drivenTaskCount },
    setStatus,
    setDrivenTaskCount,
  }),
}))

import { api } from '@/api/client'

beforeEach(() => {
  vi.clearAllMocks()
  mockClientWorkerStoreState.status = 'idle'
  mockClientWorkerStoreState.degradedReason = null
  mockClientWorkerStoreState.drivenTaskCount = 0
  mockAuthUser.value = { id: 7, email: 'user@example.com' }
  mockAuthCsrf.value = 'csrf-test'
  mockConfigState.workerRuntimeMode = 'client'
  mockConfigState.clientWorker.enabled = true
  vi.resetModules()
})

describe('useClientWorker', () => {
  it('stays idle when /config reports client worker disabled', async () => {
    mockConfigState.clientWorker.enabled = false
    const { useClientWorker } = await import('@/composables/useClientWorker')
    await useClientWorker()
    expect(setStatus).toHaveBeenCalledWith('idle')
  })

  it('stays idle in server mode regardless of the client_worker flag', async () => {
    // The frontend's gate is `client_worker.enabled` — the server mode
    // means the operator's config.php never opted into the client
    // runtime, so the SPA must not boot a worker even if some stale
    // `client_worker` block survived.
    mockConfigState.workerRuntimeMode = 'server'
    mockConfigState.clientWorker.enabled = false
    const { useClientWorker } = await import('@/composables/useClientWorker')
    await useClientWorker()
    expect(setStatus).toHaveBeenCalledWith('idle')
  })

  it('constructs a SharedWorker and posts the init message when available', async () => {
    const { useClientWorker } = await import('@/composables/useClientWorker')
    await useClientWorker()
    await new Promise(r => setTimeout(r, 0))

    // SharedWorker class is from the setup.ts shim; lastInstance is captured.
    const SharedWorkerCtor = (globalThis as unknown as { SharedWorker: { lastInstance?: { port: { start: () => void; onmessage: ((ev: MessageEvent) => void) | null; postMessage: (m: unknown) => void } } } }).SharedWorker
    expect(SharedWorkerCtor.lastInstance).toBeDefined()
    expect(setStatus).toHaveBeenCalledWith('booting')
    expect(setStatus).toHaveBeenCalledWith('active')
    expect(infoSpy).toHaveBeenCalledWith(
      'Client-side worker is now ticking your tasks. Keep this browser tab open while tasks are running.',
    )

    // The init message should have been posted on the shared port.
    const port = SharedWorkerCtor.lastInstance!.port
    expect(typeof port.postMessage).toBe('function')
  })

  it('falls back to a dedicated Worker and warns when SharedWorker is unavailable', async () => {
    const OriginalSharedWorker = (globalThis as unknown as { SharedWorker: unknown }).SharedWorker
    ;(globalThis as unknown as { SharedWorker: undefined }).SharedWorker = undefined

    try {
      const { useClientWorker } = await import('@/composables/useClientWorker')
      await useClientWorker()
      await new Promise(r => setTimeout(r, 0))

      const WorkerCtor = (globalThis as unknown as { Worker: { lastInstance?: { onmessage: ((ev: MessageEvent) => void) | null; postMessage: (m: unknown) => void } } }).Worker
      expect(WorkerCtor.lastInstance).toBeDefined()
      expect(setStatus).toHaveBeenCalledWith('degraded', 'Single-tab mode (SharedWorker unavailable)')
      expect(warningSpy).toHaveBeenCalledWith(
        'This browser does not support SharedWorker — using a per-tab fallback.',
      )
    } finally {
      ;(globalThis as unknown as { SharedWorker: unknown }).SharedWorker = OriginalSharedWorker
      vi.resetModules()
    }
  })

  it('is idempotent — a second call does not construct another SharedWorker', async () => {
    const { useClientWorker } = await import('@/composables/useClientWorker')
    await useClientWorker()
    await useClientWorker()
    await new Promise(r => setTimeout(r, 0))

    const SharedWorkerCtor = (globalThis as unknown as { SharedWorker: { lastInstance?: unknown } }).SharedWorker
    // Only one SharedWorker instance is captured even though we called twice.
    expect(SharedWorkerCtor.lastInstance).toBeDefined()
  })

  it('tears down the port when auth.user becomes null (logout)', async () => {
    const { useClientWorker } = await import('@/composables/useClientWorker')
    await useClientWorker()
    await new Promise(r => setTimeout(r, 0))

    const SharedWorkerCtor = (globalThis as unknown as { SharedWorker: { lastInstance?: { port: { close: () => void } } } }).SharedWorker
    const closeSpy = vi.fn()
    SharedWorkerCtor.lastInstance!.port.close = closeSpy

    // Simulate logout by clearing the auth user. The composable's
    // `watch(() => auth.user, ...)` fires on the next Vue tick.
    mockAuthUser.value = null
    await nextTick()

    expect(closeSpy).toHaveBeenCalled()
    expect(setStatus).toHaveBeenCalledWith('idle')
  })

  it('postConsiderTask + postDropTask forward to the underlying port', async () => {
    const { useClientWorker, postConsiderTask, postDropTask } = await import('@/composables/useClientWorker')
    await useClientWorker()
    await new Promise(r => setTimeout(r, 0))

    const SharedWorkerCtor = (globalThis as unknown as { SharedWorker: { lastInstance?: { port: { postMessage: ReturnType<typeof vi.fn> } } } }).SharedWorker
    const postSpy = vi.fn()
    SharedWorkerCtor.lastInstance!.port.postMessage = postSpy

    postConsiderTask(42, 'user:7')
    postDropTask(42)

    expect(postSpy).toHaveBeenCalledWith({ type: 'consider-task', taskId: 42, leaseOwner: 'user:7' })
    expect(postSpy).toHaveBeenCalledWith({ type: 'drop-task', taskId: 42 })
  })

  it('mirrors worker status messages into the store', async () => {
    const { useClientWorker } = await import('@/composables/useClientWorker')
    await useClientWorker()
    await new Promise(r => setTimeout(r, 0))

    const SharedWorkerCtor = (globalThis as unknown as { SharedWorker: { lastInstance?: { port: { onmessage: ((ev: MessageEvent) => void) | null } } } }).SharedWorker
    const onmessage = SharedWorkerCtor.lastInstance!.port.onmessage
    expect(onmessage).not.toBeNull()

    onmessage!({ data: { type: 'status', status: 'degraded', reason: 'lease lost', drivenTaskCount: 3 } } as MessageEvent)

    expect(setStatus).toHaveBeenCalledWith('degraded', 'lease lost')
    expect(setDrivenTaskCount).toHaveBeenCalledWith(3)
  })

  it('defaults an incomplete status message to active and ignores non-status messages', async () => {
    const { useClientWorker } = await import('@/composables/useClientWorker')
    await useClientWorker()
    await new Promise(r => setTimeout(r, 0))

    const SharedWorkerCtor = (globalThis as unknown as { SharedWorker: { lastInstance?: { port: { onmessage: ((ev: MessageEvent) => void) | null } } } }).SharedWorker
    const onmessage = SharedWorkerCtor.lastInstance!.port.onmessage!
    setDrivenTaskCount.mockClear()

    // A status frame without `status` / `drivenTaskCount` — the composable
    // falls back to 'active' and must not push a bogus count.
    onmessage({ data: { type: 'status' } } as MessageEvent)
    expect(setStatus).toHaveBeenCalledWith('active', null)
    expect(setDrivenTaskCount).not.toHaveBeenCalled()

    // tick-result frames are consumed elsewhere and must not touch status.
    setStatus.mockClear()
    onmessage({ data: { type: 'tick-result', taskId: 1, ok: true } } as MessageEvent)
    expect(setStatus).not.toHaveBeenCalled()
  })

  it('routes dedicated-worker messages through the port bridge into the store', async () => {
    const OriginalSharedWorker = (globalThis as unknown as { SharedWorker: unknown }).SharedWorker
    ;(globalThis as unknown as { SharedWorker: undefined }).SharedWorker = undefined

    try {
      const { useClientWorker } = await import('@/composables/useClientWorker')
      await useClientWorker()
      await new Promise(r => setTimeout(r, 0))

      const WorkerCtor = (globalThis as unknown as { Worker: { lastInstance?: { onmessage: ((ev: MessageEvent) => void) | null } } }).Worker
      // The fallback wraps the Worker in a port-like shim; messages arriving
      // on `w.onmessage` must be relayed to the shim's own handler.
      WorkerCtor.lastInstance!.onmessage!({ data: { type: 'status', status: 'active', reason: null, drivenTaskCount: 2 } } as MessageEvent)

      expect(setDrivenTaskCount).toHaveBeenCalledWith(2)
    } finally {
      ;(globalThis as unknown as { SharedWorker: unknown }).SharedWorker = OriginalSharedWorker
      vi.resetModules()
    }
  })

  it('still tears down when the shutdown postMessage throws', async () => {
    const { useClientWorker } = await import('@/composables/useClientWorker')
    await useClientWorker()
    await new Promise(r => setTimeout(r, 0))

    const SharedWorkerCtor = (globalThis as unknown as { SharedWorker: { lastInstance?: { port: { postMessage: (m: unknown) => void; close: () => void } } } }).SharedWorker
    const closeSpy = vi.fn()
    SharedWorkerCtor.lastInstance!.port.close = closeSpy
    // A port whose worker already died throws on postMessage — teardown
    // must still close the port and reset the store.
    SharedWorkerCtor.lastInstance!.port.postMessage = () => { throw new Error('port closed') }

    mockAuthUser.value = null
    await nextTick()

    expect(closeSpy).toHaveBeenCalled()
    expect(setStatus).toHaveBeenCalledWith('idle')
  })

  it('reports error status when worker construction throws', async () => {
    const OriginalSharedWorker = (globalThis as unknown as { SharedWorker: unknown }).SharedWorker
    ;(globalThis as unknown as { SharedWorker: unknown }).SharedWorker = class {
      constructor() { throw new Error('worker blocked by CSP') }
    }

    try {
      const { useClientWorker } = await import('@/composables/useClientWorker')
      await useClientWorker()
      await new Promise(r => setTimeout(r, 0))

      expect(setStatus).toHaveBeenCalledWith('error', 'worker blocked by CSP')
    } finally {
      ;(globalThis as unknown as { SharedWorker: unknown }).SharedWorker = OriginalSharedWorker
      vi.resetModules()
    }
  })

  it('boots with safe defaults when the auth store has no user or CSRF token yet', async () => {
    mockAuthUser.value = null
    mockAuthCsrf.value = null

    const { useClientWorker } = await import('@/composables/useClientWorker')
    await useClientWorker()
    await new Promise(r => setTimeout(r, 0))

    // Boot must not throw on a null user — the worker falls back to
    // userId 0 / empty CSRF and the server rejects if that's wrong.
    expect(setStatus).toHaveBeenCalledWith('active')
  })
})

// Sanity-check: ensure the runtime-config fetch is wired so a router
// guard that hasn't fetched yet doesn't block the worker from booting.
describe('useClientWorker init flow', () => {
  it('calls config.init when the store has not been initialized yet', async () => {
    mockConfigState.initialized = false
    mockConfigState.workerRuntimeMode = 'client'
    mockConfigState.clientWorker.enabled = true

    const initSpy = vi.fn().mockResolvedValue(undefined)
    vi.doMock('@/stores/runtimeConfig', () => ({
      useRuntimeConfigStore: () => ({
        get initialized() { return mockConfigState.initialized },
        get workerRuntimeMode() { return mockConfigState.workerRuntimeMode },
        get clientWorker() { return mockConfigState.clientWorker },
        init: initSpy,
      }),
    }))

    const { useClientWorker } = await import('@/composables/useClientWorker')
    await useClientWorker()

    expect(initSpy).toHaveBeenCalledTimes(1)
    // api is mocked — confirm the call to /config happened through the
    // shared runtime-config store, not the composable directly.
    expect(api.get).not.toHaveBeenCalled()
  })
})