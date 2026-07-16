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

  return { data, load, extensionList }
}

/** Clear the session cache for tests and explicit configuration refreshes. */
export function clearMediaAllowedTypesCache(): void {
  cache.clear()
  inflight.clear()
}

export type { AllowedTypes }
