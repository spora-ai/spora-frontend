import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Create mock store values that tests can override
// IMPORTANT: use Vue refs to match real Pinia behavior (refs are always truthy objects)
import { ref } from 'vue'

const mockStoreState = {
  csrfToken: ref<string | null>('test-token'),
  user: ref<{ id: number; email: string } | null>({ id: 1, email: 'a@b.com' }),
  initialized: ref<boolean>(true),
}

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    csrfToken: mockStoreState.csrfToken,
    user: mockStoreState.user,
    initialized: mockStoreState.initialized,
    $patch: vi.fn((patch: { csrfToken: string | null }) => {
      mockStoreState.csrfToken.value = patch.csrfToken
    }),
  }),
}))

// Spy on fetch to inspect headers
const fetchSpy = vi.spyOn(globalThis, 'fetch')

function mockFetch(response: Partial<Response> & { body?: unknown } = {}) {
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify({ data: response.body ?? {} }),
    ...response,
  } as Response)
}

function mockFetchSequence(responses: Partial<Response>[]) {
  responses.forEach((r) => {
    const body = r.body
    fetchSpy.mockResolvedValueOnce({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      statusText: String(r.status ?? 'OK'),
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(body ? { data: body } : {}),
      ...r,
    } as Response)
  })
}

// Import api AFTER vi.mock so the mock is active
import { api, speechProviderConfigs } from '@/api/client'

describe('CSRF token injection', () => {
  beforeEach(() => {
    fetchSpy.mockReset()
    setActivePinia(createPinia())
    // Reset to default logged-in state with token (using refs to match real Pinia behavior)
    mockStoreState.csrfToken.value = 'test-token'
    mockStoreState.user.value = { id: 1, email: 'a@b.com' }
    mockStoreState.initialized.value = true
  })

  describe('state-changing methods', () => {
    it('sends X-CSRF-Token header on POST when token is in store', async () => {
      mockFetch({ body: {} })

      await api.post('/tasks', { agent_id: 1, prompt: 'hello' })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [, init] = fetchSpy.mock.calls[0]
      expect(init.headers).toHaveProperty('X-CSRF-Token', 'test-token')
    })

    it('sends X-CSRF-Token header on PATCH', async () => {
      mockFetch({ body: {} })

      await api.patch('/auth/password', { current_password: 'old', new_password: 'new' })

      const [, init] = fetchSpy.mock.calls[0]
      expect(init.headers).toHaveProperty('X-CSRF-Token', 'test-token')
    })

    it('sends X-CSRF-Token header on PUT', async () => {
      mockFetch({ body: {} })

      await api.put('/agents/1', { name: 'Updated Agent' })

      const [, init] = fetchSpy.mock.calls[0]
      expect(init.headers).toHaveProperty('X-CSRF-Token', 'test-token')
    })

    it('sends X-CSRF-Token header on DELETE', async () => {
      mockFetch({ body: {} })

      await api.delete('/tasks/5')

      const [, init] = fetchSpy.mock.calls[0]
      expect(init.headers).toHaveProperty('X-CSRF-Token', 'test-token')
    })

    it('fetches fresh token from /auth/me and uses it for the request', async () => {
      // Set up state: token missing (null), user logged in
      mockStoreState.csrfToken.value = null

      // Sequence:
      // 1. GET /auth/me → returns fresh token (called before the POST)
      // 2. POST /tasks with new token → 200 success
      mockFetchSequence([
        { body: { user: { id: 1 }, csrf_token: 'fresh-token-xyz' } },
        { body: { task: { id: 1 } } },
      ])

      const result = await api.post<{ task: { id: number } }>('/tasks', {})

      // Should have made 2 fetch calls: GET /auth/me (to get token), then POST with new token
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(fetchSpy.mock.calls[0][0]).toContain('/auth/me')

      // The POST should have the new token
      const [, postInit] = fetchSpy.mock.calls[1]
      expect(postInit.headers).toHaveProperty('X-CSRF-Token', 'fresh-token-xyz')

      // Store should be updated
      expect(mockStoreState.csrfToken.value).toBe('fresh-token-xyz')
      expect(result).toEqual({ task: { id: 1 } })
    })

    it('does NOT fetch fresh token when user is not logged in', async () => {
      mockStoreState.csrfToken.value = null
      mockStoreState.user.value = null
      mockStoreState.initialized.value = false

      mockFetch({ body: {} })

      await api.post('/tasks', { agent_id: 1, prompt: 'hello' })

      // Should have made only the one POST request — no /auth/me call
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [, init] = fetchSpy.mock.calls[0]
      // Verify: X-CSRF-Token must not be set (neither as string nor as Ref object)
      expect(init.headers['X-CSRF-Token']).toBeUndefined()
    })
  })

  describe('safe methods', () => {
    it('does NOT send X-CSRF-Token header on GET', async () => {
      mockFetch({ body: { tasks: [] } })

      await api.get('/tasks')

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [, init] = fetchSpy.mock.calls[0]
      expect(init.headers).not.toHaveProperty('X-CSRF-Token')
    })
  })

  describe('session expired handler', () => {
    it('calls sessionExpiredHandler on 401 UNAUTHENTICATED when user is logged in', async () => {
      const { setupSessionHandler } = await import('@/api/client')
      const handler = vi.fn()
      setupSessionHandler(handler)

      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Session expired' } }),
      } as Response)

      await expect(api.post('/tasks', {})).rejects.toThrow()

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('does NOT call sessionExpiredHandler on 401 when user is not logged in', async () => {
      const { setupSessionHandler } = await import('@/api/client')
      const handler = vi.fn()
      setupSessionHandler(handler)

      mockStoreState.csrfToken.value = null
      mockStoreState.user.value = null

      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Session expired' } }),
      } as Response)

      await expect(api.post('/tasks', {})).rejects.toThrow()

      expect(handler).not.toHaveBeenCalled()
    })
  })

  // Regression coverage for the JSON.parse hardening — without this, a
  // misbehaving upstream returning HTML or truncated JSON would throw
  // past the request boundary and crash the calling component.
  describe('non-JSON response handling', () => {
    it('synthesizes an INVALID_JSON ApiError when the server returns HTML', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<html><body>nginx error</body></html>',
      } as Response)

      const { ApiError } = await import('@/api/client')
      let caught: unknown
      try {
        await api.get('/health')
      } catch (e) {
        caught = e
      }

      expect(caught).toBeInstanceOf(ApiError)
      const err = caught as InstanceType<typeof ApiError>
      expect(err.code).toBe('INVALID_JSON')
      expect(err.status).toBe(502)
      // User-facing message is intentionally generic (no raw server
      // bytes echoed) — the raw HTML body lands on `_rawBody` for the
      // log sink to consume. Verify the generic copy is surfaced and
      // that the raw body is NOT part of the user-facing message.
      expect(err.message).toBe('Server returned a malformed response.')
      expect(err.message).not.toContain('<html>')
    })

    it('treats an empty body as null (no JSON parse, returns undefined)', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 204,
        statusText: 'No Content',
        headers: new Headers(),
        text: async () => '',
      } as Response)

      // 204 returns undefined from the envelope unwrap — must not throw.
      const result = await api.get('/anything')
      expect(result).toBeUndefined()
    })
  })

  describe('multipart uploads', () => {
    it('omits Content-Type so fetch sets the multipart boundary', async () => {
      mockFetch({ body: { data: { id: 'abc' } } })

      const form = new FormData()
      form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt')
      await api.postForm('/media', form)

      const [, init] = fetchSpy.mock.calls[0]
      expect(init.headers).not.toHaveProperty('Content-Type')
      expect(init.body).toBe(form)
    })

    it('still injects the CSRF token for multipart POSTs', async () => {
      mockFetch({ body: { data: { id: 'abc' } } })

      const form = new FormData()
      form.append('file', new Blob(['hello']))
      await api.postForm('/media', form)

      const [, init] = fetchSpy.mock.calls[0]
      expect(init.headers).toHaveProperty('X-CSRF-Token', 'test-token')
    })
  })

  describe('query string builder', () => {
    it('appends a flat key=value pair', async () => {
      mockFetch({ body: { data: {} } })
      await api.get('/search', { q: 'hello' })
      const [url] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/search?q=hello')
    })

    it('emits repeated params when the value is an array', async () => {
      mockFetch({ body: { data: {} } })
      await api.get('/agents', { principal_id: [1, 2, 3] })
      const [url] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/agents?principal_id=1&principal_id=2&principal_id=3')
    })

    it('drops null and undefined entries from the query string', async () => {
      mockFetch({ body: { data: {} } })
      await api.get('/agents', { a: 1, b: null, c: undefined })
      const [url] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/agents?a=1')
    })

    it('drops object values to avoid [object Object] in the URL', async () => {
      mockFetch({ body: { data: {} } })
      await api.get('/agents', { filter: { foo: 'bar' } })
      const [url] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/agents')
    })

    it('drops object entries inside arrays too', async () => {
      mockFetch({ body: { data: {} } })
      await api.get('/agents', { ids: [1, { foo: 'bar' }, 2] })
      const [url] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/agents?ids=1&ids=2')
    })

    it('URL-encodes keys and values', async () => {
      mockFetch({ body: { data: {} } })
      await api.get('/search', { q: 'a/b c' })
      const [url] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/search?q=a%2Fb%20c')
    })

    it('does not append a ? when the query map is empty', async () => {
      mockFetch({ body: { data: {} } })
      await api.get('/agents', {})
      const [url] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/agents')
    })
  })

describe('speech pipeline wrappers', () => {
    it('getSpeechCapability hits GET /speech/capability and returns the envelope', async () => {
      mockFetch({
        body: {
          available: true,
          configured: true,
          providers: [{ name: 'mistral', display_name: 'Mistral', configured: true }],
        },
      })
      const { getSpeechCapability } = await import('@/api/client')
      const result = await getSpeechCapability()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/speech/capability')
      expect(init.method ?? 'GET').toBe('GET')
      // `api.get<SpeechCapability>` unwraps the `{ data: ... }` envelope
      // (see `request()` in `api/client.ts`), so the typed return is the
      // inner payload directly. (Prior implementation of this test
      // mocked the wrapper shape, which masked a runtime bug where the
      // composable dereferenced `response.data` on the already-unwrapped
      // payload — fixed in PR #144.)
      expect(result.configured).toBe(true)
      expect(result.providers).toEqual([
        { name: 'mistral', display_name: 'Mistral', configured: true },
      ])
    })

    it('postTranscribeAudio POSTs JSON body to /speech/transcribe', async () => {
      mockFetch({ body: { text: 'hello', language: 'en', duration_ms: 1234 } })
      const { postTranscribeAudio } = await import('@/api/client')
      const result = await postTranscribeAudio({
        media_id: '00000000-0000-4000-8000-000000000001',
      })
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/speech/transcribe')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({
        media_id: '00000000-0000-4000-8000-000000000001',
      }))
      expect(result.text).toBe('hello')
    })

    it('postTranscribeAudio forwards the optional language hint', async () => {
      mockFetch({ body: { text: 'hola', language: 'es', duration_ms: 900 } })
      const { postTranscribeAudio } = await import('@/api/client')
      await postTranscribeAudio({
        media_id: '00000000-0000-4000-8000-000000000002',
        language: 'es-ES',
      })
      const [, init] = fetchSpy.mock.calls[0]
      expect(init.body).toBe(JSON.stringify({
        media_id: '00000000-0000-4000-8000-000000000002',
        language: 'es-ES',
      }))
    })
  })

  describe('speechProviderConfigs', () => {
    it('list() GETs /speech/provider-configs and unwraps the envelope', async () => {
      const configs = [{ id: 1, provider_class: 'X', provider_display_name: 'X', scope: 'user', display_name: 'X', settings: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }]
      mockFetch({ body: { configs } })

      const result = await speechProviderConfigs.list()

      const [url] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/speech/provider-configs')
      expect(result).toEqual({ configs })
    })

    it('listSchema() GETs /speech/provider-configs/schema', async () => {
      const providers = [
        { class: 'A', display_name: 'A', settings_schema: [] },
        { class: 'B', display_name: 'B', settings_schema: [] },
      ]
      mockFetch({ body: { providers } })

      const result = await speechProviderConfigs.listSchema()

      const [url] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/speech/provider-configs/schema')
      expect(result).toEqual({ providers })
    })

    it('upsert() POSTs and sends X-CSRF-Token on the state-changing call', async () => {
      const config = { id: 1, provider_class: 'X', provider_display_name: 'X', scope: 'user', display_name: 'X', settings: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
      mockFetch({ body: { config } })

      await speechProviderConfigs.upsert({
        provider_class: 'X',
        scope: 'user',
        settings: { api_key: 'sk-x' },
      })

      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/speech/provider-configs')
      expect(init.method).toBe('POST')
      expect(init.headers).toHaveProperty('X-CSRF-Token', 'test-token')
      // User scope omits is_global / scope / group_id — the backend
      // defaults `principal_id` to the caller's user-principal.
      expect(JSON.parse(init.body)).toEqual({
        provider_class: 'X',
        settings: { api_key: 'sk-x' },
      })
    })

    it('upsert() translates scope=global to is_global=true (no principal_id, no scope)', async () => {
      const config = { id: 1, provider_class: 'X', provider_display_name: 'X', scope: 'global', display_name: 'Mistral Voxtral (prod)', settings: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
      mockFetch({ body: { config } })

      await speechProviderConfigs.upsert({
        provider_class: 'X',
        scope: 'global',
        display_name: 'Mistral Voxtral (prod)',
        settings: { api_key: 'sk-x', model: 'voxtral-mini-latest' },
      })

      const [, init] = fetchSpy.mock.calls[0]
      expect(JSON.parse(init.body)).toEqual({
        provider_class: 'X',
        display_name: 'Mistral Voxtral (prod)',
        is_global: true,
        settings: { api_key: 'sk-x', model: 'voxtral-mini-latest' },
      })
    })

    it('upsert() translates scope=group to scope=group + group_id for backend resolution', async () => {
      const config = { id: 1, provider_class: 'X', provider_display_name: 'X', scope: 'group', display_name: 'X', settings: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
      mockFetch({ body: { config } })

      await speechProviderConfigs.upsert({
        provider_class: 'X',
        scope: 'group',
        settings: { api_key: 'sk-x' },
        group_id: 7,
      })

      const [, init] = fetchSpy.mock.calls[0]
      // The controller resolves `group_id` (groups.id) to the matching
      // `principal_id` (principals.id) before persistence — see the
      // `resolveGroupPrincipal` helper on `SpeechProviderConfigService`.
      expect(JSON.parse(init.body)).toEqual({
        provider_class: 'X',
        scope: 'group',
        group_id: 7,
        settings: { api_key: 'sk-x' },
      })
    })

    it('upsert() omits display_name when the form did not provide one', async () => {
      mockFetch({ body: { config: { id: 1, provider_class: 'X', provider_display_name: 'X', scope: 'global', display_name: 'X', settings: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' } } })

      await speechProviderConfigs.upsert({
        provider_class: 'X',
        scope: 'global',
        settings: { api_key: 'sk-x' },
      })

      const [, init] = fetchSpy.mock.calls[0]
      const sent = JSON.parse(init.body)
      expect(sent).not.toHaveProperty('display_name')
      expect(sent.is_global).toBe(true)
    })

    it('update() PUTs to /speech/provider-configs/{id}', async () => {
      const config = { id: 7, provider_class: 'X', provider_display_name: 'X', scope: 'user', display_name: 'X', settings: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
      mockFetch({ body: { config } })

      await speechProviderConfigs.update(7, { settings: { model: 'whisper-1' } })

      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/speech/provider-configs/7')
      expect(init.method).toBe('PUT')
      expect(init.headers).toHaveProperty('X-CSRF-Token', 'test-token')
      expect(JSON.parse(init.body)).toEqual({ settings: { model: 'whisper-1' } })
    })

    it('delete() DELETEs /speech/provider-configs/{id}', async () => {
      mockFetch({ body: { deleted: true } })

      await speechProviderConfigs.delete(7)

      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/speech/provider-configs/7')
      expect(init.method).toBe('DELETE')
      expect(init.headers).toHaveProperty('X-CSRF-Token', 'test-token')
    })

    it('setDefault() POSTs to /speech/provider-configs/{id}/set-default with no body', async () => {
      const config = { id: 7, provider_class: 'X', provider_display_name: 'X', scope: 'global', display_name: 'X', settings: {}, is_default: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
      mockFetch({ body: { config } })

      const result = await speechProviderConfigs.setDefault(7)

      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/speech/provider-configs/7/set-default')
      expect(init.method).toBe('POST')
      expect(init.headers).toHaveProperty('X-CSRF-Token', 'test-token')
      // The id rides in the URL — no body payload.
      expect(init.body).toBeUndefined()
      expect(result.config.is_default).toBe(true)
    })

    it('getPreference() GETs /api/v1/speech/preference?scope=user', async () => {
      mockFetch({
        body: {
          preference: {
            config_id: 7,
            scope: 'user',
            group_id: null,
          },
        },
      })

      const result = await speechProviderConfigs.getPreference('user')

      const [url] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/speech/preference?scope=user')
      expect(result.preference.config_id).toBe(7)
      expect(result.preference.scope).toBe('user')
    })

    it('getPreference() returns config_id: null when no preference is set', async () => {
      mockFetch({
        body: {
          preference: { config_id: null, scope: 'user', group_id: null },
        },
      })

      const result = await speechProviderConfigs.getPreference('user')

      expect(result.preference.config_id).toBeNull()
    })

    it('getPreference() includes group_id when scope is group', async () => {
      mockFetch({
        body: {
          preference: { config_id: 12, scope: 'group', group_id: 4 },
        },
      })

      await speechProviderConfigs.getPreference('group', 4)

      const [url] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/speech/preference?scope=group&group_id=4')
    })

    it('setPreferred() PUTs the preference body and returns the envelope', async () => {
      mockFetch({
        body: {
          preference: { config_id: 42, scope: 'user', group_id: null },
        },
      })

      const result = await speechProviderConfigs.setPreferred({
        config_id: 42,
        scope: 'user',
      })

      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/v1/speech/preference')
      expect(init.method).toBe('PUT')
      expect(init.headers).toHaveProperty('X-CSRF-Token', 'test-token')
      expect(JSON.parse(init.body)).toEqual({
        config_id: 42,
        scope: 'user',
      })
      expect(result.preference.config_id).toBe(42)
    })

    it('setPreferred() accepts null config_id to clear the preference', async () => {
      mockFetch({ body: { preference: { config_id: null, scope: 'user', group_id: null } } })

      await speechProviderConfigs.setPreferred({ config_id: null, scope: 'user' })

      const [, init] = fetchSpy.mock.calls[0]
      expect(JSON.parse(init.body)).toEqual({ config_id: null, scope: 'user' })
    })

    it('propagates ApiError when the backend rejects the request', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Admins only.' } }),
      } as Response)

      const { ApiError } = await import('@/api/client')
      await expect(speechProviderConfigs.upsert({
        provider_class: 'X',
        scope: 'global',
        settings: {},
      })).rejects.toThrowError(ApiError)
    })
  })
})
