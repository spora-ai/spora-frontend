// CSRF strategy: session cookies are scoped SameSite=Lax by PHP's default session config.
// A CSRF token (X-CSRF-Token header) is required on all state-changing requests (POST/PUT/PATCH/DELETE).
// The token is obtained from the auth store after login/register/me and sent as a header.

import { log } from '@/utils/logger'
import type { useAuthStore } from '@/stores/auth'
import type {
  SpeechCapability,
  TranscriptionResultDto,
  TranscribeRequestBody,
} from '@/types/speech'
import type {
  SpeechProviderClassSchema,
  SpeechProviderConfig,
  SpeechProviderScope,
} from '@/types/speechProviderConfig'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type SessionExpiredHandler = () => void
let _sessionExpiredHandler: SessionExpiredHandler | null = null

export function setupSessionHandler(handler: SessionExpiredHandler): void {
  _sessionExpiredHandler = handler
}

// State-changing HTTP methods that require a CSRF token
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrap(val: unknown): unknown {
  return val && typeof val === 'object' && 'value' in val ? val.value : val
}

// Plugin frontends install their own Pinia via app.use(createPinia()),
// which steals the module-level active Pinia. Without a captured
// reference, useAuthStore() inside request() (which runs outside Vue
// setup/inject context) returns a fresh empty store on the plugin's
// Pinia, omitting X-CSRF-Token.
type AuthStore = ReturnType<typeof useAuthStore>
let _hostAuthStore: AuthStore | null = null

export function setHostAuthStore(store: AuthStore): void {
  _hostAuthStore = store
}

async function injectCsrfIfNeeded(method: string, headers: Record<string, string>): Promise<void> {
  if (!STATE_CHANGING_METHODS.has(method)) {
    return
  }
  const auth = _hostAuthStore ?? (await import('@/stores/auth')).useAuthStore()
  const csrfVal = unwrap(auth.csrfToken) as string | null
  if (csrfVal) {
    headers['X-CSRF-Token'] = csrfVal
    return
  }
  if (!unwrap(auth.user)) {
    return
  }
  // Token missing but user appears logged in — fetch a fresh one from /auth/me
  const meRes = await api.get<{ csrf_token?: string }>('/auth/me')
  if (meRes.csrf_token) {
    auth.$patch({ csrfToken: meRes.csrf_token })
    headers['X-CSRF-Token'] = meRes.csrf_token
  }
}

async function notifySessionExpired(): Promise<void> {
  const auth = await import('@/stores/auth').then(m => m.useAuthStore())
  if (unwrap(auth.initialized) && unwrap(auth.user)) {
    _sessionExpiredHandler?.()
  }
}

function buildError(body: Record<string, unknown> | null, status: number): ApiError {
  const err = body?.error as Record<string, string> | undefined
  const code = err?.code ?? 'UNKNOWN_ERROR'
  const message = err?.message ?? `HTTP ${status}`
  return new ApiError(message, code, status)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = buildHeaders(init)
  await injectCsrfIfNeeded(method, headers)

  const response = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers,
  })

  const body = await parseBody(response)

  if (!response.ok) {
    await handleErrorResponse(method, path, response, body)
    throw buildError(body, response.status)
  }

  // body.data is the standard envelope; fall back to the whole body for bare responses.
  return ((body === null ? undefined : (body.data ?? body)) as T)
}

function buildHeaders(init: RequestInit): Record<string, string> {
  const isMultipart = typeof FormData !== 'undefined' && init.body instanceof FormData
  return {
    Accept: 'application/json',
    ...(isMultipart ? {} : { 'Content-Type': 'application/json' }),
    ...(init.headers ? Object.fromEntries(new Headers(init.headers)) : {}),
  }
}

// Parse JSON once; treat an empty body (204, unexpected HTML) as null.
// A malformed payload from a misbehaving upstream must not throw past
// this point — return a synthetic { error } envelope so callers can
// still build an ApiError and surface the failure.
async function parseBody(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text()
  if (text.length === 0) return null
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    // Don't echo raw response bytes into user-facing ApiError.message —
    // backend debug pages (Laravel debugbar, PHP stack traces) leak
    // stack frames + file paths that should never reach the operator.
    // The raw body is stashed on `_rawBody` for the log sink to
    // consume; the user-facing message stays generic.
    return {
      error: { code: 'INVALID_JSON', message: 'Server returned a malformed response.' },
      _rawBody: text.slice(0, 200),
    }
  }
}

async function handleErrorResponse(
  method: string,
  path: string,
  response: Response,
  body: Record<string, unknown> | null,
): Promise<void> {
  const err = body?.error as Record<string, string> | undefined
  if (response.status === 401 && err?.code === 'UNAUTHENTICATED') {
    // Routed to the session-expiry toast — keep the dev signal at debug
    // level so we don't double-notify the user via the console.
    log.debug(`${method} ${path} → 401 UNAUTHENTICATED (session expired)`)
    await notifySessionExpired()
    return
  }
  // `_rawBody` is the only field that may carry server-controlled
  // bytes (HTML stack trace, debug page, etc.); surface it to the log
  // sink but never to the user-facing ApiError. The user-facing
  // `err?.message` is still server-controlled, but the backend's
  // error contract is meant to keep that string clean — anything
  // sensitive should live in `_rawBody` and stay in the console.
  const rawBody = typeof body?._rawBody === 'string' ? body._rawBody : null
  const level = response.status >= 500 ? 'error' : 'warn'
  log[level](
    `${method} ${path} → ${response.status} ${err?.code ?? 'UNKNOWN_ERROR'} (${err?.message ?? 'no message'})`,
    rawBody !== null ? { rawBody } : undefined,
  )
}

/**
 * Encode one query value, returning null when the value should be dropped
 * (null/undefined/object/function/symbol). Centralizes the nullability
 * check so the loop body stays under the cognitive-complexity threshold
 * and SonarQube's static analyzer can prove `String(value)` only ever
 * sees a primitive scalar.
 */
function encodeQueryValue(value: string | number | boolean | bigint | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return encodeURIComponent(String(value))
}

/**
 * Build a query string from a flat key/value map. Array values are emitted
 * as repeated keys (`?principal_id=1&principal_id=2`), matching the way
 * PHP parses `$_GET` for FastRoute's {id} routes and the controller's
 * `?principal_id=` collector. Non-primitive scalars (objects) are dropped
 * to avoid `[object Object]` in the URL.
 */
function buildQueryString(query: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, raw] of Object.entries(query)) {
    if (Array.isArray(raw)) {
      for (const value of raw) {
        const encoded = encodeScalar(value)
        if (encoded !== null) parts.push(`${encodeURIComponent(key)}=${encoded}`)
      }
      continue
    }
    const encoded = encodeScalar(raw)
    if (encoded !== null) parts.push(`${encodeURIComponent(key)}=${encoded}`)
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`
}

/**
 * Narrow an arbitrary query value to a primitive scalar the encoder can
 * safely stringify. Returns null for null/undefined/object/function/
 * symbol so the caller can skip them without ever calling
 * `String(objectValue)` and getting `[object Object]`.
 */
function encodeScalar(value: unknown): string | null {
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') {
    return encodeQueryValue(value as string | number | boolean | bigint)
  }
  return null
}

export const api = {
  get: <T>(path: string, query?: Record<string, unknown>) => {
    const suffix = query ? buildQueryString(query) : ''
    return request<T>(path + suffix)
  },
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  postForm: <T>(path: string, body: FormData) =>
    request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
}

/**
 * Speech-to-text capability pipeline (recording). Thin wrappers over
 * `api.get` / `api.post` so call sites read declaratively —
 * `getSpeechCapability()` / `postTranscribeAudio(...)` — and so the
 * wire-shape types in `types/speech.ts` flow through to the caller
 * without an extra `as` cast at every site.
 *
 * The capability endpoint is read by `useSpeechCapability` and cached
 * for the session. The transcribe endpoint is one-shot; the server
 * persists the transcript back onto the `MediaAsset` row so subsequent
 * chat re-renders can re-use the cached text without a second API call.
 *
 * `api.get<T>` and `api.post<T>` unwrap the `{ data: ... }` envelope on
 * successful responses (see `request()`), so `T` always describes the
 * inner payload — never the wrapper.
 */
export function getSpeechCapability(): Promise<SpeechCapability> {
  return api.get<SpeechCapability>('/speech/capability')
}

export function postTranscribeAudio(body: TranscribeRequestBody): Promise<TranscriptionResultDto> {
  return api.post<TranscriptionResultDto>('/speech/transcribe', body)
}

/**
 * Speech-to-text provider configuration. Mirrors the LLM config shape:
 * single instance per provider class per scope (admin sees global, callers
 * see their own user-scope overrides). `upsert` accepts scope in the body
 * because the controller authorizes scope='global' for admins only and
 * scope='user' for any caller; the UI picks the scope based on which
 * route mounted the page.
 *
 * Per-group writes (scope='group') ride the same endpoint — the
 * controller authorises group admin OR global admin, and the body's
 * `group_id` names the group. The list endpoint takes an optional
 * `?group_id=N` filter so the Group settings page can request just
 * one group's configs without scanning the user's full set.
 *
 * Per-agent overrides are NOT this endpoint — they live on the
 * existing `PUT /agents/{id}/tools/{tool}/override` route and are
 * driven by `useToolSettings(agentId).putSettings()` from the
 * `AgentToolsSpeechSection` component.
 */
export const speechProviderConfigs = {
  list(): Promise<{ configs: SpeechProviderConfig[] }> {
    return api.get<{ configs: SpeechProviderConfig[] }>('/speech/provider-configs')
  },
  listForGroup(groupId: number): Promise<{ configs: SpeechProviderConfig[] }> {
    return api.get<{ configs: SpeechProviderConfig[] }>('/speech/provider-configs', { group_id: groupId })
  },
  listSchema(): Promise<{ providers: SpeechProviderClassSchema[] }> {
    return api.get<{ providers: SpeechProviderClassSchema[] }>('/speech/provider-configs/schema')
  },
  upsert(payload: {
    provider_class: string
    scope: SpeechProviderScope
    settings: Record<string, string>
    group_id?: number
  }): Promise<{ config: SpeechProviderConfig }> {
    return api.post<{ config: SpeechProviderConfig }>('/speech/provider-configs', payload)
  },
  update(
    id: number,
    payload: { settings: Record<string, string> },
  ): Promise<{ config: SpeechProviderConfig }> {
    return api.put<{ config: SpeechProviderConfig }>(`/speech/provider-configs/${id}`, payload)
  },
  delete(id: number): Promise<{ deleted: true }> {
    return api.delete<{ deleted: true }>(`/speech/provider-configs/${id}`)
  },
}
