/**
 * useMediaAllowedTypes — fetches the dynamic upload allowlist from
 * `GET /api/v1/media/allowed-types` and caches it for the session.
 *
 * The frontend composer uses the response to populate the
 * `<input type="file" accept>` attribute and the user-visible
 * "Allowed: …" legend. When `agentId` is provided, the request
 * includes `?agent_id=…` so the response also includes image MIME
 * types when the agent's LLM supports them.
 */
import { ref } from 'vue'
import { api } from '@/api/client'

interface AllowedTypes {
  mime_types: string[]
  extensions: string[]
}

const cache = new Map<string, AllowedTypes>()
const inflight = new Map<string, Promise<AllowedTypes>>()

export function useMediaAllowedTypes() {
  const data = ref<AllowedTypes | null>(null)

  async function load(agentId?: number): Promise<AllowedTypes> {
    const key = agentId === undefined ? 'default' : String(agentId)
    const cached = cache.get(key)
    if (cached !== undefined) {
      data.value = cached
      return cached
    }

    const pending = inflight.get(key)
    if (pending !== undefined) {
      const result = await pending
      data.value = result
      return result
    }

    const query = agentId === undefined ? '' : `?agent_id=${agentId}`
    const request = api.get<AllowedTypes>(`/media/allowed-types${query}`)
    inflight.set(key, request)
    try {
      const result = await request
      cache.set(key, result)
      data.value = result
      return result
    } finally {
      inflight.delete(key)
    }
  }

  function extensionList(): string {
    return (data.value?.extensions ?? [])
      .map((extension) => extension.startsWith('.') ? extension : `.${extension}`)
      .join(',')
  }

  /**
   * Filter `data.mime_types` down to `image/*` entries.
   *
   * Fallback semantics:
   *   - `data` not yet loaded (network round-trip in flight) → return
   *     {@link DEFAULT_IMAGE_MIME_TYPES} so the picker's `accept`
   *     attribute isn't wide-open while we wait.
   *   - `data` loaded but `mime_types` empty → return `[]`. The
   *     operator has explicitly disabled image uploads, so the picker
   *     reflects that ("no images allowed") rather than falling back.
   */
  function imageMimeList(): string[] {
    if (data.value === null) {
      return [...DEFAULT_IMAGE_MIME_TYPES]
    }
    return data.value.mime_types.filter((mime) => mime.toLowerCase().startsWith('image/'))
  }

  /** Comma-separated image MIME list, ready for `<input type="file" accept>`. */
  function imageAccept(): string {
    return imageMimeList().join(',')
  }

  return { data, load, extensionList, imageMimeList, imageAccept }
}

/**
 * Image MIME types returned during the network round-trip before
 * `GET /media/allowed-types` has resolved. Mirrors the backend default
 * (`spora-core/app/Services/MediaArchive/MediaArchiveConfig.php` —
 * `png`, `jpeg`, `webp`) so we don't widen the picker to formats the
 * server would reject.
 */
export const DEFAULT_IMAGE_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

/** Clear the session cache for tests and explicit configuration refreshes. */
export function clearMediaAllowedTypesCache(): void {
  cache.clear()
  inflight.clear()
}

export type { AllowedTypes }
