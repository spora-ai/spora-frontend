<script setup lang="ts">
/**
 * AgentToolsSpeechSection — per-agent speech-to-text provider override.
 *
 * Each agent can pick an existing speech config (user / group / global)
 * to override the cascade, or leave the cascade default in place. The
 * agent override is a single FK pointer, not a free-form settings
 * editor — settings live on the chosen config row and the cascade reads
 * them at transcribe time. Wire shape: `PATCH /agents/{id}` with
 * `{ speech_driver_config_id }`.
 *
 * Cascade: tier 1 is the agent override above, read from
 * `agent.speech_driver_config_id` against the principal-scoped slot.
 * Tiers 2-5 come from the capability endpoint's resolved
 * `effective_class` + `effective_source` — the backend walks the
 * cascade, so the badge works for any registered STT class.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useSpeechProviderConfigsStore } from '@/stores/speechProviderConfigs'
import { useAgentStore } from '@/stores/agent'
import { useSpeechCapability } from '@/composables/useSpeechCapability'
import { useToast } from '@/composables/useToast'
import AgentSpeechConfigModal from '@/components/agent/AgentSpeechConfigModal.vue'
import { Icon } from '@spora-ai/components/icons'
import { ApiError } from '@/api/client'
import type {
  SpeechProviderConfig,
  SpeechProviderScope,
} from '@/types/speechProviderConfig'

interface Agent {
  id: number
  principal_id?: number | null
  principal?: { type?: 'user' | 'group' | string; group_id?: number | null } | null
  speech_driver_config_id?: number | null
}

const props = defineProps<{
  agent: Agent
  agentId: number
}>()

const store = useSpeechProviderConfigsStore()
const agentStore = useAgentStore()
// Tier 1 is the agent override, re-read from the store's `currentAgent`
// whenever the agent row updates after a PATCH round-trip.
const capability = useSpeechCapability()
const toast = useToast()

// The slot is already principal-scoped (server-side `?agent_id=N` filter),
// so it holds exactly the configs this operator can pick for this agent.
const slot = computed(() => store.getSlot(props.agentId))

const agentOverride = computed<SpeechProviderConfig | null>(() => {
  const id = agentStore.currentAgent?.speech_driver_config_id ?? null
  if (id === null) return null
  return slot.value.configs.find((c) => c.id === id) ?? null
})
const loadingOverride = ref(false)
const error = ref<string | null>(null)
const selectedConfigId = ref<number | null>(null)
// Tracks what `selectedConfigId` was last synced to, so the watcher skips
// the synthetic write from initial-load initialisation.
const lastPersistedConfigId = ref<number | null>(null)
const showCreate = ref(false)

// Sorted global → group → user, then by display_name within each scope.
// The agent override is excluded: it is the row being written here.
const availableConfigs = computed<SpeechProviderConfig[]>(() => {
  const merged = [
    ...slot.value.configs.filter((c) => c.scope === 'global'),
    ...slot.value.configs.filter((c) => c.scope === 'group'),
    ...slot.value.configs.filter((c) => c.scope === 'user'),
  ]
  const scopeOrder: Record<SpeechProviderScope, number> = {
    global: 0,
    group: 1,
    user: 2,
    agent: 3,
  }
  return [...merged].sort((a, b) => {
    const scopeDiff = scopeOrder[a.scope] - scopeOrder[b.scope]
    if (scopeDiff !== 0) return scopeDiff
    return a.display_name.localeCompare(b.display_name)
  })
})

// Reconciles the dropdown against the FK. When no FK is set, pre-select the
// principal's preferred config (loaded by `loadPreferenceFor()`) so the
// dropdown mirrors the cascade badge instead of reading as "use default".
// The persistence watcher below turns any change into a PATCH round-trip.
function syncSelectedConfigFromOverride(): void {
  const fkId = agentStore.currentAgent?.speech_driver_config_id ?? null
  if (fkId !== null) {
    // FK points at a config the local cache hasn't loaded: surface the note
    // and let the operator clear it by picking the cascade default.
    const match = slot.value.configs.find((c) => c.id === fkId)
    if (match === undefined) {
      selectedConfigId.value = null
      unmatchedFkId.value = fkId
    } else {
      selectedConfigId.value = match.id
      unmatchedFkId.value = null
    }
    lastPersistedConfigId.value = selectedConfigId.value
    return
  }
  unmatchedFkId.value = null

  // Only pre-select when the preferred config is actually in the scoped
  // dropdown; otherwise fall back to "Use cascade default".
  const preferredId = slot.value.preferredSpeech?.config_id ?? null
  if (preferredId !== null) {
    const preferred = slot.value.configs.find((c) => c.id === preferredId)
    if (preferred !== undefined) {
      selectedConfigId.value = preferred.id
      lastPersistedConfigId.value = selectedConfigId.value
      return
    }
  }

  selectedConfigId.value = null
  lastPersistedConfigId.value = selectedConfigId.value
}

// The FK is armed but points at a row the operator can no longer see. The
// dropdown shows "Use cascade default" — without this note, picking that
// would silently overwrite a config they cannot preview.
const unmatchedFkId = ref<number | null>(null)

function loadAgentOverride(): Promise<void> {
  loadingOverride.value = true
  error.value = null
  return Promise.resolve()
    .then(() => syncSelectedConfigFromOverride())
    .catch((e: unknown) => {
      error.value = e instanceof Error ? e.message : 'Failed to load agent override.'
    })
    .finally(() => {
      loadingOverride.value = false
    })
}

/** Map a cascade source to the matching config slice; 'fallback' has none. */
function configsForSource(source: string): SpeechProviderConfig[] {
  switch (source) {
    case 'user_preference': return slot.value.configs.filter((c) => c.scope === 'user')
    case 'group_preference': return slot.value.configs.filter((c) => c.scope === 'group')
    case 'global_default': return slot.value.configs.filter((c) => c.scope === 'global')
    default: return []
  }
}

interface BadgeMeta {
  /** Suffix in parentheses after the resolved display name, e.g. `(user default)`. */
  label: string
  /** Tailwind classes for the badge background+text. */
  tone: string
  /** Source tag used by the empty-state guard (`agent-speech-empty` v-if check below). */
  source: string
}

/** Keys are the backend's `effective_source` values. */
const SOURCE_BADGE: Record<string, BadgeMeta> = {
  user_preference:  { label: 'user default',   tone: 'bg-primary/10 text-primary',                       source: 'user default' },
  group_preference: { label: 'group default',  tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-300', source: 'group default' },
  global_default:   { label: 'global default', tone: 'bg-muted text-muted-foreground',                  source: 'global default' },
  fallback:         { label: 'fallback',       tone: 'bg-muted text-muted-foreground',                  source: 'fallback' },
}

const NOT_CONFIGURED: BadgeMeta = {
  label: 'No speech provider configured',
  tone: 'bg-muted text-muted-foreground',
  source: 'not configured',
}

const cascadeBadge = computed<BadgeMeta>(() => {
  // Tier 1 — agent override on this specific agent always wins.
  if (agentOverride.value) {
    const display = agentOverride.value.display_name || agentOverride.value.provider_display_name
    return {
      label: `Using ${display} (agent override)`,
      tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
      source: 'agent override',
    }
  }

  // Tier 2-5 — delegate to the backend's resolved cascade. The capability
  // endpoint's `effective_class` + `effective_source` carry the actual
  // winner (user preference → group preference → global default →
  // fallback) for ANY registered STT class.
  const resolvedClass = capability.effectiveClass.value
  const resolvedSource = capability.effectiveSource.value
  if (resolvedClass === null || resolvedSource === null) {
    return NOT_CONFIGURED
  }

  const tierConfigs = configsForSource(resolvedSource)
  const tierConfig = tierConfigs.find((c) => c.provider_class === resolvedClass)
  const provider = store.providerByClass(resolvedClass)
  const display =
    tierConfig?.display_name
    ?? tierConfig?.provider_display_name
    ?? provider?.display_name
    ?? resolvedClass
  const meta = SOURCE_BADGE[resolvedSource] ?? SOURCE_BADGE.fallback
  return {
    label: `Using ${display} (${meta.label})`,
    tone: meta.tone,
    source: meta.source,
  }
})

// Called when the inline create modal emits `created`. `upsert()` does not
// refresh the cache, so re-fetch here; the `selectedConfigId` watcher then
// writes the FK to the freshly-loaded row.
async function onSpeechCreated(config: SpeechProviderConfig): Promise<void> {
  // Also refresh the provider schema so the create modal's class dropdown
  // reflects newly-registered STT classes; `store.providers` is otherwise
  // fetched once in `ensure()` and never refreshed.
  await Promise.all([
    store.loadConfigsFor(props.agentId, props.agentId),
    store.loadProviders(),
  ])
  selectedConfigId.value = config.id
  showCreate.value = false
}

// Save the operator's dropdown choice. `null` clears the FK. A single PATCH
// round-trip carries the canonical row back, so `agentStore.currentAgent`
// and the `agentOverride` computed re-evaluate on their own.
async function persistConfigSelection(configId: number | null): Promise<void> {
  error.value = null
  const previousId = lastPersistedConfigId.value
  try {
    await agentStore.updateAgent(props.agentId, {
      speech_driver_config_id: configId,
    })
    if (configId === null) {
      toast.success('Agent speech override removed.')
    } else {
      toast.success('Agent speech override saved.')
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to save agent override.'
    // Roll the dropdown back so the UI reflects the server's truth.
    selectedConfigId.value = previousId
  }
}

watch(selectedConfigId, (newId) => {
  if (newId === lastPersistedConfigId.value) return
  void persistConfigSelection(newId).then(() => {
    lastPersistedConfigId.value = selectedConfigId.value
  })
})

// Reconcile the dropdown when the FK changes from outside this section
// (page reload, or a sibling section PATCHing the same row).
watch(
  () => agentStore.currentAgent?.speech_driver_config_id,
  () => syncSelectedConfigFromOverride(),
)

onMounted(async () => {
  // `?agent_id=N` narrows to configs valid for this agent, so navigating
  // between agents cannot leak another principal's configs into the slot.
  // The capability refresh also takes `agentId` so the badge tracks the
  // agent's ownership rather than the caller's own preference.
  const principal = agentStore.currentAgent?.principal ?? props.agent.principal ?? null
  const preferredScope: { kind: 'user' } | { kind: 'group'; groupId: number } =
    principal?.type === 'group' && typeof principal.group_id === 'number'
      ? { kind: 'group', groupId: principal.group_id }
      : { kind: 'user' }
  await Promise.all([
    store.ensure(props.agentId, props.agentId, preferredScope),
    capability.refresh(props.agentId),
  ])
  await loadAgentOverride()
})

// Re-sync when the agent prop changes. A new `props.agentId` is a new cache
// key, hence a new principal scope — the previous slot stays untouched.
watch(
  () => props.agentId,
  async (nextId, prevId) => {
    if (nextId === prevId) return
    const nextAgent = agentStore.currentAgent?.id === nextId
      ? agentStore.currentAgent
      : null
    const principal = nextAgent?.principal ?? props.agent.principal ?? null
    const preferredScope: { kind: 'user' } | { kind: 'group'; groupId: number } =
      principal?.type === 'group' && typeof principal.group_id === 'number'
        ? { kind: 'group', groupId: principal.group_id }
        : { kind: 'user' }
    syncSelectedConfigFromOverride()
    void capability.refresh(nextId)
    await store.ensure(nextId, nextId, preferredScope)
    await loadAgentOverride()
  },
)
</script>

<template>
  <section class="rounded-xl border border-border bg-card divide-y divide-border">
    <div class="px-5 py-4 flex items-start justify-between gap-4">
      <div>
        <h2 class="text-base font-semibold">
          Speech
        </h2>
        <p class="text-xs text-muted-foreground mt-0.5">
          Speech-to-text provider override for this agent.
        </p>
      </div>
      <span
        data-testid="agent-speech-cascade"
        class="text-xs rounded-full px-2 py-1 font-medium shrink-0"
        :class="cascadeBadge.tone"
      >
        {{ cascadeBadge.label }}
      </span>
    </div>

    <div
      v-if="error"
      role="alert"
      data-testid="agent-speech-error"
      class="px-5 py-3 text-xs text-destructive"
    >
      {{ error }}
    </div>

    <output
      v-if="unmatchedFkId !== null"
      data-testid="agent-speech-unmatched-fk"
      class="px-5 py-3 text-xs text-amber-700 dark:text-amber-300"
    >
      Config #{{ unmatchedFkId }} is no longer visible to you. Select "Use cascade default" to clear the override.
    </output>

    <!-- Shown only when nothing is configured AND the operator has nothing
         to pick from. -->
    <div
      v-if="!loadingOverride && !agentOverride && cascadeBadge.source === 'not configured' && availableConfigs.length === 0"
      class="px-5 py-4"
    >
      <div class="rounded-xl border border-dashed border-border bg-muted/30 p-6 flex flex-col items-center text-center gap-3">
        <div class="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
          <Icon
            name="mic"
            class="h-5 w-5 text-muted-foreground"
          />
        </div>
        <div class="flex flex-col gap-1 max-w-sm">
          <p class="text-sm font-medium">
            No speech provider configured
          </p>
          <p class="text-xs text-muted-foreground">
            This agent has no speech-to-text. Configure a global provider in
            Settings → Speech, or set an override for this agent.
          </p>
        </div>
        <button
          type="button"
          data-testid="agent-speech-create"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          @click="showCreate = true"
        >
          <Icon
            name="plus"
            class="h-4 w-4 mr-1.5"
          />
          Set STT provider
        </button>
      </div>
    </div>

    <!-- Dropdown row — shown whenever something is in effect. Selection
         saves immediately; "+ New" opens the inline create modal. -->
    <div
      v-else-if="!loadingOverride"
      class="px-5 py-4"
    >
      <div class="flex items-end gap-3">
        <div class="flex-1">
          <label
            for="agent-speech-config"
            class="text-xs font-medium text-muted-foreground"
          >
            Speech config
          </label>
          <select
            id="agent-speech-config"
            v-model="selectedConfigId"
            class="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            data-testid="agent-speech-config-select"
          >
            <option :value="null">
              — Use cascade default —
            </option>
            <option
              v-for="c in availableConfigs"
              :key="c.id"
              :value="c.id"
            >
              {{ c.display_name }} ({{ c.scope }})
            </option>
          </select>
        </div>
        <button
          type="button"
          data-testid="agent-speech-create"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          @click="showCreate = true"
        >
          + New
        </button>
      </div>
    </div>

    <div
      v-if="loadingOverride"
      class="px-5 py-4 text-sm text-muted-foreground"
    >
      Loading…
    </div>

    <AgentSpeechConfigModal
      v-if="showCreate"
      :show="showCreate"
      :providers="store.providers"
      @update:show="showCreate = $event"
      @created="onSpeechCreated"
    />
  </section>
</template>
