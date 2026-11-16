/**
 * The agent's step cap follows the instance's ceiling.
 *
 * The ceiling is `SPORA_MAX_STEPS` on the backend, and it reaches the SPA
 * through the runtime config — the admin settings are admin-only, and a
 * plain user editing their own agent cannot read the bound there.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRuntimeConfigStore, DEFAULT_MAX_AGENT_STEPS } from '@/stores/runtimeConfig'
import { api } from '@/api/client'

vi.mock('@/api/client', () => ({
  api: { get: vi.fn() },
}))

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>

function configResponse(extra: Record<string, unknown> = {}) {
  return {
    allow_registration: true,
    allow_group_creation: true,
    plugin_install_enabled: false,
    plugin_catalog_enabled: false,
    agent_api_enabled: false,
    group_api_enabled: false,
    global_api_enabled: false,
    worker_runtime_mode: 'server',
    default_lang: 'en',
    client_worker: {
      enabled: false,
      tick_endpoint: '/api/v1/tasks/{taskId}/tick',
      housekeeping_endpoint: '/api/v1/worker/housekeeping',
      housekeeping_interval_seconds: 300,
      tick_interval_ms: 2000,
      tick_lease_seconds: 600,
    },
    ...extra,
  }
}

describe('the runtime config and the step cap ceiling', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockedGet.mockReset()
  })

  it('takes the ceiling from the server', async () => {
    mockedGet.mockResolvedValue(configResponse({ max_agent_steps: 320 }))

    const store = useRuntimeConfigStore()
    await store.init()

    expect(store.maxAgentSteps).toBe(320)
  })

  it('falls back to the default when an older server does not send one', async () => {
    mockedGet.mockResolvedValue(configResponse())

    const store = useRuntimeConfigStore()
    await store.init()

    expect(store.maxAgentSteps).toBe(DEFAULT_MAX_AGENT_STEPS)
  })

  it('falls back to the default when the request fails', async () => {
    mockedGet.mockRejectedValue(new Error('offline'))

    const store = useRuntimeConfigStore()
    await store.init()

    expect(store.maxAgentSteps).toBe(DEFAULT_MAX_AGENT_STEPS)
  })

  it('ignores a value that is not a number', async () => {
    mockedGet.mockResolvedValue(configResponse({ max_agent_steps: 'a lot' }))

    const store = useRuntimeConfigStore()
    await store.init()

    expect(store.maxAgentSteps).toBe(DEFAULT_MAX_AGENT_STEPS)
  })

  it.each([
    ['zero', 0],
    ['a negative number', -5],
    ['a fraction', 12.5],
    ['null', null],
  ])('ignores %s, which is not a step limit', async (_label, value) => {
    mockedGet.mockResolvedValue(configResponse({ max_agent_steps: value }))

    const store = useRuntimeConfigStore()
    await store.init()

    // A zero would give the settings input a `max` below its `min`, and a
    // fraction is not a number of steps.
    expect(store.maxAgentSteps).toBe(DEFAULT_MAX_AGENT_STEPS)
  })

  it('keeps the published ceiling apart from the display fallback', async () => {
    mockedGet.mockResolvedValue(configResponse({ max_agent_steps: 320 }))

    const store = useRuntimeConfigStore()
    await store.init()

    // The published ceiling is what a cap is clamped against; the
    // fallback only fills the input's bound when the backend published
    // none. A backend that published 320 has a bound of 320, not of the
    // default.
    expect(store.publishedMaxAgentSteps).toBe(320)
    expect(store.maxAgentSteps).toBe(320)
  })

  it('publishes no ceiling when the backend sends none', async () => {
    mockedGet.mockResolvedValue(configResponse())

    const store = useRuntimeConfigStore()
    await store.init()

    // Null, not the default: a cap must not be clamped against a bound
    // the backend never stated.
    expect(store.publishedMaxAgentSteps).toBeNull()
    expect(store.maxAgentSteps).toBe(DEFAULT_MAX_AGENT_STEPS)
  })
})
