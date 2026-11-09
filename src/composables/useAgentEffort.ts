/**
 * useAgentEffort — the agent's reasoning-effort capability.
 *
 * `GET /agents/{id}/effort` answers with the effective driver's level set,
 * the labels the driver chose, and the effective config's default. The
 * answer only changes when the agent's LLM configuration changes, so it is
 * cached per agent id — the shape `useMediaAllowedTypes` uses for the upload
 * allowlist.
 *
 * The cache is dropped wherever that answer can change: the agent's LLM
 * configuration is edited, and the user drifts away (the capability belongs
 * to the user who asked for it).
 *
 * The *selection* is not held here: it lives in the agent store, because the
 * initial composer and the follow-up bar are two component trees that have
 * to agree on the level the operator picked. This composable keeps it in
 * step with the level set: a choice the driver no longer offers is dropped
 * when the capability that replaced it is adopted.
 */
import { computed, ref } from 'vue'
import { api } from '@/api/client'
import { useAgentStore } from '@/stores/agent'
import { effortLevelLabel } from '@/utils/effortLevels'
import {
  capabilityByAgent,
  clearAgentEffortCache,
  epochFor,
  inflightByAgent,
} from '@/composables/agentEffortCache'
import type { AgentEffort, EffortLevel, EffortOption, EffortSelection } from '@/types/effort'

export { clearAgentEffortCache } from '@/composables/agentEffortCache'

export function useAgentEffort() {
  const agentStore = useAgentStore()
  const agentId = ref<number | null>(null)
  const effort = ref<AgentEffort | null>(null)

  function adopt(payload: AgentEffort, id: number): void {
    // The answer belongs to the agent it was requested for. A completion
    // that arrives after the operator switched agents must not overwrite
    // the active agent's capability — the picker would offer levels the
    // active agent's driver may not accept.
    if (agentId.value !== id) return
    effort.value = payload
    reconcileSelection(payload, id)
  }

  /**
   * Keep the operator's choice and the driver's level set in step.
   *
   * The choice is stored per agent, but the level set belongs to the
   * driver's configuration: a level the driver does not declare is
   * rejected by the backend, so a choice that is no longer on offer cannot
   * survive the capability that replaced it.
   */
  function reconcileSelection(payload: AgentEffort, id: number): void {
    if (payload.levels.length === 0) {
      // The driver speaks no effort: there is no picker, so there is no
      // choice to keep — and the chat must not carry a level at all.
      agentStore.clearEffortSelection(id)
      return
    }
    const selected = agentStore.getEffortSelection(id)
    if (selected === undefined) {
      // The endpoint's default is the level the chat uses until the
      // operator picks another one, so it seeds the selection.
      if (payload.supported) {
        agentStore.setEffortSelection(id, fallbackSelection(payload))
      }
      return
    }
    // The model default is not a level: it is on offer whatever the driver
    // declares.
    if (selected === '') return
    if (payload.levels.some(level => level.value === selected)) return
    agentStore.setEffortSelection(id, fallbackSelection(payload))
  }

  /**
   * The level to fall back to when the operator's choice is no longer on
   * offer: the effective config's default when the driver declares it, and
   * the model default otherwise — the one choice no driver rejects.
   */
  function fallbackSelection(payload: AgentEffort): EffortSelection {
    const fallback = payload.default
    if (fallback !== null && payload.levels.some(level => level.value === fallback)) {
      return fallback
    }
    return ''
  }

  /**
   * The capability the endpoint answered with, or `undefined` when there is
   * none to speak of.
   *
   * The picker is optional: a backend without the endpoint, a network
   * hiccup — the chat then sends no `effort` at all. Only the request
   * failing is expected here; a bug in the code around it must not hide
   * behind this.
   */
  async function fetchCapability(id: number): Promise<AgentEffort | undefined> {
    try {
      return await api.get<AgentEffort | undefined>(`/agents/${id}/effort`)
    } catch {
      return undefined
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
    const epoch = epochFor(id)
    const cached = capabilityByAgent.get(id)
    if (cached !== undefined) {
      adopt(cached, id)
      return
    }
    const pending = inflightByAgent.get(id)
    if (pending !== undefined) {
      const payload = await pending
      if (payload !== undefined && epoch === epochFor(id)) {
        adopt(payload, id)
      }
      return
    }
    const request = fetchCapability(id)
    inflightByAgent.set(id, request)
    try {
      const payload = await request
      if (payload === undefined) {
        // No capability: an empty response, or a request that failed. The
        // picker stays hidden either way.
        return
      }
      if (epoch !== epochFor(id)) {
        // The cache was dropped while the request was on the wire: the
        // answer describes a configuration that no longer holds.
        return
      }
      capabilityByAgent.set(id, payload)
      adopt(payload, id)
    } finally {
      // Only the request that is still registered may clear the slot: a
      // dropped request must not unregister the one that replaced it.
      if (inflightByAgent.get(id) === request) {
        inflightByAgent.delete(id)
      }
    }
  }

  /**
   * Ask for the capability again, ignoring the cached one.
   *
   * The cached answer is what the backend refused: the driver's level set
   * moved on, so the cache has to go before the question is asked again.
   * The fresh answer is reconciled against the operator's choice, which is
   * what the refusal was about.
   */
  async function refresh(id: number): Promise<void> {
    clearAgentEffortCache(id)
    await load(id)
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
   * `undefined` means "the chat sends no `effort` at all": the capability
   * is not known yet, or the driver speaks no effort. An empty string is
   * the explicit "model default".
   */
  const selection = computed<EffortSelection | undefined>(() => {
    if (effort.value === null || !supported.value) return undefined
    if (levels.value.length === 0) return undefined
    const id = agentId.value
    if (id === null) return undefined
    return agentStore.getEffortSelection(id) ?? defaultLevel.value ?? ''
  })

  function select(value: EffortSelection): void {
    const id = agentId.value
    if (id === null) return
    agentStore.setEffortSelection(id, value)
  }

  return { supported, levels, selection, load, refresh, select }
}
