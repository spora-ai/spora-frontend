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

let cached: AllowedTypes | null = null
const inflight = ref(false)

export function useMediaAllowedTypes() {
  const data = ref<AllowedTypes | null>(cached)

  async function load(agentId?: number): Promise<AllowedTypes> {
    if (cached !== null) {
      data.value = cached
      return cached
    }
    if (inflight.value) {
      while (inflight.value) {
        await new Promise((r) => setTimeout(r, 50))
      }
      if (cached !== null) {
        data.value = cached
        return cached
      }
    }
    inflight.value = true
    try {
      const query = agentId !== undefined ? `?agent_id=${agentId}` : ''
      const result = await api.get<{ data: AllowedTypes }>(`/media/allowed-types${query}`)
      cached = result.data
      data.value = cached
      return cached
    } finally {
      inflight.value = false
    }
  }

  function extensionList(): string {
    return (data.value?.extensions ?? []).join(',')
  }

  return { data, load, extensionList }
}