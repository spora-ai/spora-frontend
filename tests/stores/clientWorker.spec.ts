import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useClientWorkerStore } from '@/stores/clientWorker'

/**
 * useClientWorkerStore — state transitions and computed flags.
 *
 * The store mirrors the worker status (idle / booting / active /
 * degraded / error) and the driven task count. The composable
 * (`useClientWorker`) is responsible for translating the wire
 * protocol into store calls; this spec validates the state machine
 * alone so it stays small and focused.
 */
describe('useClientWorkerStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts in the idle (server mode) state', () => {
    const store = useClientWorkerStore()
    expect(store.status).toBe('idle')
    expect(store.isServerMode).toBe(true)
    expect(store.isActive).toBe(false)
    expect(store.isDegraded).toBe(false)
    expect(store.isError).toBe(false)
  })

  it('setStatus transitions to active and updates the reason + lastEventAt', () => {
    const store = useClientWorkerStore()
    const before = Date.now()
    store.setStatus('active')
    expect(store.isActive).toBe(true)
    expect(store.degradedReason).toBeNull()
    expect(store.lastEventAt).not.toBeNull()
    expect(store.lastEventAt).toBeGreaterThanOrEqual(before)
  })

  it('setStatus captures the degraded reason for the indicator label', () => {
    const store = useClientWorkerStore()
    store.setStatus('degraded', 'Single-tab mode (SharedWorker unavailable)')
    expect(store.isDegraded).toBe(true)
    expect(store.degradedReason).toBe('Single-tab mode (SharedWorker unavailable)')
  })

  it('setStatus with null reason explicitly clears the previous degraded reason', () => {
    const store = useClientWorkerStore()
    store.setStatus('degraded', 'temporary')
    store.setStatus('active', null)
    expect(store.degradedReason).toBeNull()
  })

  it('setDrivenTaskCount updates the counter without touching status', () => {
    const store = useClientWorkerStore()
    store.setDrivenTaskCount(3)
    expect(store.drivenTaskCount).toBe(3)
    expect(store.status).toBe('idle')
  })

  it('isError reflects the error status', () => {
    const store = useClientWorkerStore()
    store.setStatus('error', 'init failed')
    expect(store.isError).toBe(true)
    expect(store.isActive).toBe(false)
    expect(store.isDegraded).toBe(false)
  })
})