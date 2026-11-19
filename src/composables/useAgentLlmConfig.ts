/**
 * useAgentLlmConfig — the LLM configuration an agent actually runs on.
 *
 * `GET /llm-configs/effective?agent_id=N` resolves the cascade server-side:
 * the agent's own configuration, else the owning principal's preference, else
 * that principal's own default, else the global default. The tiers belong to
 * the principal that owns the agent — a group-owned agent resolves against the
 * group, not against the caller — so the frontend never re-implements them.
 *
 * The composer used to read the *caller's* own preference, which named the
 * operator's personal configuration under a group-owned agent that runs on the
 * group's, and fell back to a generic wording for an agent whose own
 * configuration lives in a principal scope the caller cannot list. The
 * endpoint is the only place that knows the answer.
 *
 * The load is best-effort. A caller who cannot see the agent gets a 404, and
 * a backend without the endpoint answers 422; neither is the composer's to
 * report, so the load never throws. A failed lookup leaves the label empty
 * rather than claiming that nothing is configured — the server never said
 * that, and the agent may well have one.
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { api } from '@/api/client'
import { i18n } from '@/i18n'
import type {
  EffectiveLLMConfig,
  LLMConfigResource,
  LLMConfigSource,
} from '@/types/llmConfig'

export interface UseAgentLlmConfig {
  /** The configuration the agent runs on, or null when none is configured. */
  config: Ref<LLMConfigResource | null>
  /** The tier that supplied it. */
  source: Ref<LLMConfigSource>
  loading: Ref<boolean>
  /**
   * Whether the last load failed. A failed lookup is not an answer: the
   * server never said "nothing is configured", so a surface must not report
   * that on its behalf.
   */
  failed: Ref<boolean>
  /** The configuration's name, qualified by the tier that supplied it. */
  label: ComputedRef<string>
  load(agentId: number): Promise<void>
}

const SOURCES: ReadonlySet<LLMConfigSource> = new Set([
  'agent',
  'group_preference',
  'user_preference',
  'group_default',
  'user_default',
  'global_default',
  'none',
])

/**
 * The wording a tier earns in the label. The agent's own configuration needs
 * none — the name already says which configuration it is — and "nothing is
 * configured" reads as a sentence of its own.
 */
function suffixFor(source: LLMConfigSource): string | null {
  switch (source) {
    case 'user_preference':
      return i18n.global.t('(preferred)')
    case 'group_preference':
      return i18n.global.t('(group preferred)')
    case 'user_default':
      return i18n.global.t('(default)')
    case 'group_default':
      return i18n.global.t('(group default)')
    case 'global_default':
      return i18n.global.t('(global default)')
    case 'agent':
    case 'none':
      return null
  }
}

/**
 * The tier the endpoint named, or `none` when it named one this build does
 * not know. An unknown tier earns no wording: the configuration's name is
 * still true, only the qualification of it would be a guess.
 */
function normaliseSource(value: unknown): LLMConfigSource {
  return SOURCES.has(value as LLMConfigSource) ? (value as LLMConfigSource) : 'none'
}

export function useAgentLlmConfig(): UseAgentLlmConfig {
  const config = ref<LLMConfigResource | null>(null)
  const source = ref<LLMConfigSource>('none')
  const loading = ref(false)
  const resolved = ref(false)
  const failed = ref(false)
  // The request the surface is waiting for. Two loads of the same agent
  // share its id, so the id alone cannot tell a stale answer from the
  // current one — the generation can.
  let generation = 0

  async function load(id: number): Promise<void> {
    const request = ++generation
    loading.value = true
    // The previous answer belongs to the agent the operator left.
    resolved.value = false
    failed.value = false
    try {
      const result = await api.get<EffectiveLLMConfig>('/llm-configs/effective', { agent_id: id })
      // The answer belongs to the request the surface is waiting for. One
      // that arrives after the operator moved on describes a configuration
      // the surface no longer shows.
      if (request !== generation) return
      config.value = result?.config ?? null
      source.value = normaliseSource(result?.source)
    } catch {
      if (request !== generation) return
      config.value = null
      source.value = 'none'
      // The lookup failed, which is not the same as the server answering
      // that nothing is configured. The distinction is the difference between
      // an answer and the absence of one.
      failed.value = true
    } finally {
      if (request === generation) {
        loading.value = false
        resolved.value = true
      }
    }
  }

  const label = computed<string>(() => {
    // Until the endpoint answers, the effective configuration is unknown —
    // reporting "nothing is configured" would be a claim nobody made yet.
    if (!resolved.value) return ''
    // A failed lookup is unknown for the same reason: the server never said
    // the agent has no configuration, so neither may this surface.
    if (failed.value) return ''
    const effective = config.value
    if (effective === null) return i18n.global.t('No LLM configuration')
    const suffix = suffixFor(source.value)
    return suffix === null ? effective.name : `${effective.name} ${suffix}`
  })

  return { config, source, loading, failed, label, load }
}
