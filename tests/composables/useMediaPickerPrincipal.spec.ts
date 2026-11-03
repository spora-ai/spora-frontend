/**
 * openMediaPicker — the principal-scoped listing.
 *
 * The real overlay is mounted here rather than a stub: the question is
 * whether the principal a caller names reaches the listing query, and a stub
 * cannot answer that. The wrapper's own spec stubs the overlay to keep the
 * modal stack out of the way.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    postForm: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/api/client', () => ({
  default: apiMock,
  api: apiMock,
  ApiError: class ApiError extends Error {
    status = 0
    code = 'TEST'
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

vi.mock('@spora-ai/components/icons', () => ({
  Icon: { name: 'Icon', template: '<i />' },
}))

import { openMediaPickerWithHandle } from '@/composables/useMediaPicker'

function listResponse() {
  return { assets: [], page: 1, perPage: 24, total: 0, lastPage: 1 }
}

beforeEach(() => {
  apiMock.get.mockReset()
  apiMock.get.mockResolvedValue(listResponse())
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('openMediaPicker with a principal', () => {
  it('scopes the listing to the principal the caller named', async () => {
    const handle = openMediaPickerWithHandle({ principalId: 42 })
    await flushPromises()
    await flushPromises()

    const url = String(apiMock.get.mock.calls[0]?.[0])
    expect(url).toContain('principal_id=42')
    // The legacy ownership filter is the opposite of a scope: it lists what
    // the caller owns, which is every principal's assets when the caller is a
    // plugin acting for one of them.
    expect(url).not.toContain('ownership=')

    handle.cancel()
    await handle.promise
  })

  it('keeps the legacy ownership filter when no principal is named', async () => {
    const handle = openMediaPickerWithHandle()
    await flushPromises()
    await flushPromises()

    const url = String(apiMock.get.mock.calls[0]?.[0])
    expect(url).toContain('ownership=mine')
    expect(url).not.toContain('principal_id=')

    handle.cancel()
    await handle.promise
  })
})
