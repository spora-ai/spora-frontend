import { setActivePinia, createPinia } from 'pinia'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useFeatureEnabled } from '@/composables/useFeatureEnabled'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { effectScope, type EffectScope } from 'vue'

vi.mock('@/api/client', () => ({
  api: { get: vi.fn() },
}))

import { api } from '@/api/client'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }

function flags(): Record<string, ReturnType<typeof useFeatureEnabled>> {
  const scope: EffectScope = effectScope()
  const out: Record<string, ReturnType<typeof useFeatureEnabled>> = {}
  scope.run(() => {
    out.agent_api = useFeatureEnabled('agent_api')
    out.plugin_install = useFeatureEnabled('plugin_install')
  })
  return out
}

describe('agent_api feature flag', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('is false until the server has answered', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}))

    const f = flags()
    useRuntimeConfigStore().init()

    // The tab mints a credential, so it must not be offered speculatively
    // while the server is still being consulted.
    expect(f.agent_api.value).toBe(false)
  })

  it('is false when the config fetch fails', async () => {
    mockApi.get.mockRejectedValue(new Error('offline'))

    const f = flags()
    await useRuntimeConfigStore().init()

    expect(f.agent_api.value).toBe(false)
    expect(useRuntimeConfigStore().initialized).toBe(true)
  })

  it('follows the server when it reports the feature on', async () => {
    mockApi.get.mockResolvedValue({ agent_api_enabled: true })

    const f = flags()
    await useRuntimeConfigStore().init()

    expect(f.agent_api.value).toBe(true)
    expect(useRuntimeConfigStore().flagFor('agent_api')).toBe(true)
  })

  it('is off when the server omits the field', async () => {
    // A legacy or trimmed config response must not enable it by default.
    mockApi.get.mockResolvedValue({ allow_registration: true })

    const f = flags()
    await useRuntimeConfigStore().init()

    expect(f.agent_api.value).toBe(false)
  })

  it('is not derived from the worker runtime mode', async () => {
    // Deliberate: the keys page warns about client-worker mode rather than
    // disappearing, so an operator can still see and revoke what they minted.
    mockApi.get.mockResolvedValue({ agent_api_enabled: true, worker_runtime_mode: 'client' })

    const f = flags()
    await useRuntimeConfigStore().init()

    expect(useRuntimeConfigStore().workerRuntimeMode).toBe('client')
    expect(f.agent_api.value).toBe(true)
  })

  it('does not disturb the existing plugin gates', async () => {
    mockApi.get.mockResolvedValue({ plugin_install_enabled: true, plugin_catalog_enabled: false })

    const f = flags()
    await useRuntimeConfigStore().init()

    expect(f.plugin_install.value).toBe(true)
    expect(useRuntimeConfigStore().flagFor('plugin_catalog')).toBe(false)
  })

  it('is reachable through flagFor like every other flag', async () => {
    mockApi.get.mockResolvedValue({ agent_api_enabled: true })
    await useRuntimeConfigStore().init()

    expect(computed(() => useRuntimeConfigStore().flagFor('agent_api')).value).toBe(true)
  })
})
