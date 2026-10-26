import type { Mock } from 'vitest'

/**
 * The mocked shape of `@/api/client`'s `api` object.
 *
 * `vi.mock('@/api/client', …)` swaps the module at runtime, but TypeScript
 * still sees the real module's types — so a test has to cast the import to
 * the mocked shape before it can assert on the mock. Casting to
 * `ReturnType<typeof vi.fn>` types `api` as a *single* function mock, and
 * every `mockApi.get` then reads as a property that does not exist.
 *
 * `Mock` is Vitest's own mock type, so `mockApi.get.mockResolvedValue(…)`
 * keeps its full mock API.
 */
export type ApiMock = {
  get: Mock
  post: Mock
  postForm: Mock
  patch: Mock
  put: Mock
  delete: Mock
}
