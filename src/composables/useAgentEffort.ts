/**
 * useAgentEffort — the agent's reasoning-effort capability.
 *
 * `GET /agents/{id}/effort` answers with the effective driver's level set,
 * the labels the driver chose, and the effective config's default. The
 * payload does not change while the session runs, so it is cached per agent
 * id — the shape `useMediaAllowedTypes` uses for the upload allowlist.
 *
 * The *selection* is not held here: it lives in the agent store, because the
 * initial composer and the follow-up bar are two component trees that have
 * to agree on the level the operator picked.
 */
import { computed, ref } from 'vue'
import { api } from '@/api/client'
import { useAgentStore } from '@/stores/agent'
import { effortLevelLabel } from '@/utils/effortLevels'
import type { AgentEffort, EffortLevel, EffortOption, EffortSelection } from '@/types/effort'

const cache = new Map<number, AgentEffort>()
const inflight = new Map<number, Promise<AgentEffort | undefined>>()

export function useAgentEffort() {
  const agentStore = useAgentStore()
  const agentId = ref<number | null>(null)
  const effort = ref<AgentEffort | null>(null)

  function adopt(payload: AgentEffort, id: number): void {
    effort.value = payload
    // The endpoint's default is the level the chat uses until the operator
    // picks another one, so it seeds the selection.
    if (payload.supported && agentStore.getEffortSelection(id) === undefined) {
      agentStore.setEffortSelection(id, payload.default ?? '')
    }
  }

  async function load(id: number): Promise<void> {
    if (agentId.value !== id) {
      // The capability belongs to one agent. Carrying the previous agent's
      // level over to the next one would send a level the new agent's
      // driver may not accept.
      effort.value = null
    }
    agentId.value = id
    const cached = cache.get(id)
    if (cached !== undefined) {
      adopt(cached, id)
      return
    }
    const pending = inflight.get(id)
    if (pending !== undefined) {
      const payload = await pending
      if (payload !== undefined) {
        adopt(payload, id)
      }
      return
    }
    try {
      const request = api.get<AgentEffort | undefined>(`/agents/${id}/effort`)
      inflight.set(id, request)
      const payload = await request
      if (payload === undefined) {
        // An empty response is not a capability; the picker stays hidden.
        return
      }
      cache.set(id, payload)
      adopt(payload, id)
    } finally {
      inflight.delete(id)
    }
  }

  const supported = computed(() => effort.value?.supported === true)

  /**
   * The levels the picker offers, in the order the endpoint listed them.
   * The endpoint's own label wins; the local map is the fallback for a
   * level it did not name.
   */
  const levels = computed<EffortOption[]>(() => {
    const fetched = effort.value?.levels ?? []
    return fetched.map(level => ({
      value: level.value,
      label: typeof level.label === 'string' && level.label.trim() !== ''
        ? level.label
        : effortLevelLabel(level.value),
    }))
  })

  const defaultLevel = computed<EffortLevel | null>(() => effort.value?.default ?? null)

  /**
   * The level the next message carries.
   *
   * `undefined` means "the capability is not known yet": the chat sends no
   * `effort` at all and the backend applies the config's default. An empty
   * string is the explicit "model default".
   */
  const selection = computed<EffortSelection | undefined>(() => {
    if (effort.value === null || !supported.value) return undefined
    const id = agentId.value
    if (id === null) return undefined
    return agentStore.getEffortSelection(id) ?? defaultLevel.value ?? ''
  })

  function select(value: EffortSelection): void {
    const id = agentId.value
    if (id === null) return
    agentStore.setEffortSelection(id, value)
  }

  return { supported, levels, selection, load, select }
}

/** Clear the session cache for tests and explicit configuration refreshes. */
export function clearAgentEffortCache(): void {
  cache.clear()
  inflight.clear()
}
