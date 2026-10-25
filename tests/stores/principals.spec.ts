import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/principals', () => ({
  fetchMyPrincipals: vi.fn(),
}))

import { fetchMyPrincipals } from '@/api/principals'
import { usePrincipalsStore } from '@/stores/principals'
import type { Principal } from '@/types/principal'

const mockPrincipal: Principal = {
  id: 1,
  type: 'user',
  user_id: 7,
  name: 'admin',
}

describe('usePrincipalsStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  it('load populates principals', async () => {
    vi.mocked(fetchMyPrincipals).mockResolvedValueOnce([mockPrincipal])
    const store = usePrincipalsStore()
    await store.load()
    expect(store.principals).toEqual([mockPrincipal])
    expect(store.currentPrincipalId).toBeNull()
  })

  it('setCurrent updates the currentPrincipalId', () => {
    const store = usePrincipalsStore()
    store.setCurrent(1)
    expect(store.currentPrincipalId).toBe(1)
    store.setCurrent(null)
    expect(store.currentPrincipalId).toBeNull()
  })
})
