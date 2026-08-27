import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
  },
}))

import { api } from '@/api/client'
import { fetchMyPrincipals } from '@/api/principals'

const mockApi = api as ReturnType<typeof vi.fn>

const mockPrincipal = {
  id: 1,
  kind: 'user',
  user_id: 7,
  name: 'admin',
  email: 'admin@example.com',
}

describe('principals api', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('fetchMyPrincipals unwraps response', async () => {
    mockApi.get.mockResolvedValueOnce({ principals: [mockPrincipal] })
    const list = await fetchMyPrincipals()
    expect(list).toEqual([mockPrincipal])
    expect(mockApi.get).toHaveBeenCalledWith('/principals/me')
  })
})
