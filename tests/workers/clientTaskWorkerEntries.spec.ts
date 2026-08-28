import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * clientTaskWorker.shared / .dedicated — the two Vite worker entry points.
 *
 * Both are thin adapters that wire the host worker's message channel to a
 * {@link createClientWorkerCore} instance. They reference the ambient `self`
 * worker global, so each test stubs `self` with a fake scope, re-imports the
 * module (module side effects run at import time), and then drives the
 * captured listener the way a real host worker would.
 */

interface FakeScope {
  addEventListener: (type: string, listener: (ev: Event) => void) => void
  postMessage: (msg: unknown) => void
  listeners: Map<string, (ev: Event) => void>
}

function createFakeScope(): FakeScope {
  const listeners = new Map<string, (ev: Event) => void>()
  return {
    listeners,
    addEventListener: (type, listener) => { listeners.set(type, listener) },
    postMessage: vi.fn(),
  }
}

const INIT = {
  type: 'init' as const,
  userId: 1,
  csrfToken: 'csrf-test',
  tickEndpoint: '/api/v1/tasks/{taskId}/tick',
  housekeepingEndpoint: '/api/v1/worker/housekeeping',
  tickIntervalMs: 2000,
  housekeepingIntervalSeconds: 300,
  tickLeaseSeconds: 600,
  baseUrl: 'https://example.test',
}

/** Minimal stand-in for the `MessagePort` a SharedWorker hands to `connect`. */
interface FakePort {
  postMessage: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  addEventListener: (type: string, listener: (ev: Event) => void) => void
  listeners: Map<string, (ev: Event) => void>
}

function createFakePort(): FakePort {
  const listeners = new Map<string, (ev: Event) => void>()
  return {
    listeners,
    postMessage: vi.fn(),
    start: vi.fn(),
    addEventListener: (type, listener) => { listeners.set(type, listener) },
  }
}

describe('clientTaskWorker.dedicated', () => {
  let scope: FakeScope

  beforeEach(async () => {
    vi.resetModules()
    scope = createFakeScope()
    vi.stubGlobal('self', scope)
    vi.stubGlobal('fetch', vi.fn())
    await import('@/workers/clientTaskWorker.dedicated')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registers a message listener on the worker global at import time', () => {
    expect(scope.listeners.has('message')).toBe(true)
  })

  it('forwards a posted init message into the core and relays status back via self.postMessage', () => {
    const listener = scope.listeners.get('message')!
    listener({ data: INIT } as MessageEvent)

    // The core answers `init` with a status broadcast — proving the
    // `port.postMessage` adapter is wired to `self.postMessage`.
    expect(scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status', status: 'active' }),
    )
  })

  it('relays consider-task and shutdown through the same channel', () => {
    const listener = scope.listeners.get('message')!
    listener({ data: INIT } as MessageEvent)
    listener({ data: { type: 'consider-task', taskId: 42, leaseOwner: 'user:1' } } as MessageEvent)
    listener({ data: { type: 'shutdown' } } as MessageEvent)

    // Shutdown cancels the timers via the injected clearTimeout adapter and
    // returns the core to idle.
    expect(scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status', status: 'idle' }),
    )
  })
})

describe('clientTaskWorker.shared', () => {
  let scope: FakeScope

  beforeEach(async () => {
    vi.resetModules()
    scope = createFakeScope()
    vi.stubGlobal('self', scope)
    vi.stubGlobal('fetch', vi.fn())
    await import('@/workers/clientTaskWorker.shared')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registers a connect listener on the worker global at import time', () => {
    expect(scope.listeners.has('connect')).toBe(true)
  })

  it('starts the client port and drives the core for a connecting tab', () => {
    const connect = scope.listeners.get('connect')!
    const port = createFakePort()
    connect({ ports: [port] } as unknown as MessageEvent)

    expect(port.start).toHaveBeenCalled()

    const onMessage = port.listeners.get('message')!
    onMessage({ data: INIT } as MessageEvent)

    // Status goes back down the connecting client's port, not to `self` —
    // a SharedWorker answers each tab on its own channel.
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status', status: 'active' }),
    )
    expect(scope.postMessage).not.toHaveBeenCalled()
  })

  it('shares one core across all connecting tabs and broadcasts status updates', () => {
    const connect = scope.listeners.get('connect')!
    const portA = createFakePort()
    const portB = createFakePort()
    connect({ ports: [portA] } as unknown as MessageEvent)
    connect({ ports: [portB] } as unknown as MessageEvent)

    // Only portA posts `init` — that's enough. portB inherits the boot
    // state from the shared core. Without the single-core design, each
    // tab would run its own tick + housekeeping loop and N tabs would
    // produce N redundant `/tick` requests for the same task.
    portA.listeners.get('message')!({ data: INIT } as MessageEvent)

    expect(portA.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status', status: 'active' }),
    )
    expect(portB.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status', status: 'active' }),
    )
  })

  it('ignores a connect event that carries no port', () => {
    const connect = scope.listeners.get('connect')!
    expect(() => connect({ ports: [] } as unknown as MessageEvent)).not.toThrow()
  })

  it('prunes a port that closes so the broadcast loop skips it', () => {
    const connect = scope.listeners.get('connect')!
    const portA = createFakePort()
    const portB = createFakePort()
    connect({ ports: [portA] } as unknown as MessageEvent)
    connect({ ports: [portB] } as unknown as MessageEvent)

    portB.listeners.get('close')!({} as Event)

    portA.listeners.get('message')!({ data: INIT } as MessageEvent)

    // After prune, portB should not receive the broadcast.
    portA.postMessage.mockClear()
    portB.postMessage.mockClear()
    portA.listeners.get('message')!({
      data: { type: 'consider-task', taskId: 42, leaseOwner: 'user:1' },
    } as MessageEvent)

    expect(portA.postMessage).toHaveBeenCalled()
    expect(portB.postMessage).not.toHaveBeenCalled()
  })

  it('relays consider-task and shutdown for a connected tab', () => {
    const connect = scope.listeners.get('connect')!
    const port = createFakePort()
    connect({ ports: [port] } as unknown as MessageEvent)

    const onMessage = port.listeners.get('message')!
    onMessage({ data: INIT } as MessageEvent)
    // consider-task exercises the injected `now` clock, shutdown the
    // injected `clearTimeout` adapter.
    onMessage({ data: { type: 'consider-task', taskId: 42, leaseOwner: 'user:1' } } as MessageEvent)
    onMessage({ data: { type: 'shutdown' } } as MessageEvent)

    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status', status: 'idle' }),
    )
  })
})
