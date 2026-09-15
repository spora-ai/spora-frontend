<script setup lang="ts">
/**
 * AgentToolsSpeechSection — per-agent speech-to-text provider override.
 *
 * Each agent can pick an existing speech config (user / group / global)
 * to override the cascade, or leave the cascade default in place. The
 * `+ New` button opens an inline create modal — same UX as
 * `AgentLlmConfigModal` — so the operator does not have to bounce to
 * /settings/speech to author their first config. The agent override
 * is a single FK pointer (a `speech_provider_configurations.id`), not
 * a free-form settings editor — the settings live on the chosen
 * config row and the cascade reads them at transcribe time.
 *
 * Wire shape: `PATCH /agents/{id}` with `{ speech_driver_config_id }`.
 * Same path the LLM FK (`llm_driver_config_id`) uses — the column
 * was added in migration 0081 with the FK layered on in 0082. The
 * legacy per-agent tool override endpoint
 * (`PUT /agents/{id}/tools/{tool}/override`) is the deprecated
 * `agent_tool_overrides` path and 404s for the speech tool class.
 *
 * Cascade derivation:
 *   - Tier 1 (agent override on this specific agent) is read from
 *     `agent.speech_driver_config_id` and looked up against the
 *     `speechProviderConfigs` store's cached rows so the badge
 *     shows the operator-friendly display name.
 *   - Tiers 2-5 (user preference → group preference → global default →
 *     fallback) come from the capability endpoint's resolved
 *     `effective_class` + `effective_source` — the backend walks the
 *     cascade for us, so the badge always reflects the actual class
 *     that will be used (and works for any registered STT class,
 *     not just the bundled OpenAI-compatible one).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useSpeechProviderConfigsStore } from '@/stores/speechProviderConfigs'
import { useAgentStore } from '@/stores/agent'
import { useSpeechCapability } from '@/composables/useSpeechCapability'
import { useToast } from '@/composables/useToast'
import AgentSpeechConfigModal from '@/components/agent/AgentSpeechConfigModal.vue'
import Icon from '@/components/ui/Icon.vue'
import { ApiError } from '@/api/client'
import type {
  SpeechProviderConfig,
  SpeechProviderScope,
} from '@/types/speechProviderConfig'

interface Agent {
  id: number
  principal_id?: number | null
  group_id?: number | null
  speech_driver_config_id?: number | null
}

const props = defineProps<{
  agent: Agent
  agentId: number
}>()

 const store = useSpeechProviderConfigsStore()
const agentStore = useAgentStore()
// Cascade tier 2-5 (user preference → group preference → global default
// → fallback) comes from the capability endpoint's resolved class +
// source. Tier 1 (agent override) is `agentStore.currentAgent.speech_driver_config_id`,
// re-read whenever the store updates after a PATCH round-trip.
const capability = useSpeechCapability()
const toast = useToast()

// Tier-1 override: a synthesised view onto the actual config row the
// FK points at. Settings live on the FK row, not on this ref.
const agentOverride = computed<SpeechProviderConfig | null>(() => {
  const id = agentStore.currentAgent?.speech_driver_config_id ?? null
  if (id === null) return null
  return store.configs.find((c) => c.id === id) ?? null
})
const loadingOverride = ref(false)
const error = ref<string | null>(null)
const selectedConfigId = ref<number | null>(null)
// Mirrors the last value `selectedConfigId` was synced to (either from
// a fresh load or from a successful save). The watcher compares the
// incoming value against this to skip the synthetic write triggered by
// initial-load initialisation.
const lastPersistedConfigId = ref<number | null>(null)
const showCreate = ref(false)

// All configs the agent owner can pick, sorted global → group → user,
// then alphabetically by display_name within each scope. The agent
// override is not in this list — it is the row being written when the
// operator picks one of these.
const availableConfigs = computed<SpeechProviderConfig[]>(() => {
  const merged = [
    ...store.globalConfigs,
    ...store.groupConfigs,
    ...store.personalConfigs,
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

// Tier 1 of the cascade is the agent's `speech_driver_config_id` FK —
// re-read from the store's `currentAgent` whenever the agent row
// updates (PATCH response, fetch on mount, sibling writes). No
// dedicated network call: the agent page already loaded the agent
// row, and PATCH responses carry the canonical value back so the
// store mirrors the truth.
function syncSelectedConfigFromOverride(): void {
  const fkId = agentStore.currentAgent?.speech_driver_config_id ?? null
  if (fkId === null) {
    selectedConfigId.value = null
  } else {
    // Trust the FK — the config row is whatever the store knows about.
    // If the FK points at a config that hasn't been loaded yet
    // (e.g. group-only config the user can no longer see), the dropdown
    // falls back to "Use cascade default" and the badge keeps the truth.
    const match = store.configs.find((c) => c.id === fkId)
    selectedConfigId.value = match?.id ?? null
  }
  lastPersistedConfigId.value = selectedConfigId.value
}

function loadAgentOverride(): Promise<void> {
  loadingOverride.value = true
  error.value = null
  // The FK lives on the agent row; the agent page loaded it once and
  // passes it as a prop. The PATCH round-trip below refreshes
  // `agentStore.currentAgent`, so any caller that watches the store
  // picks up the new value automatically.
  return Promise.resolve()
    .then(() => syncSelectedConfigFromOverride())
    .catch((e: unknown) => {
      error.value = e instanceof Error ? e.message : 'Failed to load agent override.'
    })
    .finally(() => {
      loadingOverride.value = false
    })
}

/**
 * Map a cascade source (the value the backend's capability endpoint puts
 * in `effective_source`) to the matching config list. Tier 1 is the local
 * `agentOverride` — handled separately in `cascadeBadge` below — but
 * tiers 2-4 each have their own list, and 'fallback' has no list (the
 * backend picked first-configured-wins). Pulling this out of the computed
 * keeps `cascadeBadge` branch-free and avoids the nested-ternary that
 * Sonar flagged.
 */
function configsForSource(source: string): SpeechProviderConfig[] {
  switch (source) {
    case 'user_preference': return store.personalConfigs
    case 'group_preference': return store.groupConfigs
    case 'global_default': return store.globalConfigs
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

/**
 * Badge presentation per cascade source — keys are the source strings the
 * backend emits in `effective_source`, values are the badge label / tone /
 * source-tag emitted by `cascadeBadge`. Unknown sources (defence-in-depth
 * for future backend changes) fall through to the 'fallback' entry.
 */
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

// Called when the inline create modal emits `created`. The store's
// `upsert()` action already calls `loadConfigs()`, so the new config
// is now in `store.configs`; we auto-select it by id, and the watcher
// on `selectedConfigId` writes the agent override. The modal closes
// itself when the form emits `created` (see AgentSpeechConfigModal).
function onSpeechCreated(config: SpeechProviderConfig): void {
  selectedConfigId.value = config.id
  showCreate.value = false
}

// Save the operator's dropdown choice. `null` clears the FK
// (cascade falls back to user → group → global default); any other id
// writes `agents.speech_driver_config_id` to that config. Single
// PATCH round-trip — the agent's response carries the canonical row
// back so `agentStore.currentAgent` mirrors the truth and the
// computed `agentOverride` re-evaluates automatically.
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
// (e.g. the agent page reloads, or a sibling section PATCHes the same
// row). The computed `agentOverride` re-derives automatically; the
// watcher just resyncs the dropdown ref so the user's selection state
// is faithful.
watch(
  () => agentStore.currentAgent?.speech_driver_config_id,
  () => syncSelectedConfigFromOverride(),
)

onMounted(async () => {
  await Promise.all([
    store.ensure(),
    capability.refresh(),
  ])
  if (props.agent.group_id !== null && props.agent.group_id !== undefined) {
    try {
      await store.loadForGroup(props.agent.group_id)
    } catch {
      // 404 / 403 / network — surface only the inline error, the
      // cascade badge will fall back to user → global.
    }
  }
  await loadAgentOverride()
})

// Re-sync when the agent prop changes (e.g. navigating between agents
// without unmounting the page). No network call — the agent page
// already loaded the new agent and passed it via the prop.
watch(
  () => props.agentId,
  () => syncSelectedConfigFromOverride(),
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

    <!-- Empty state — shown only when nothing is configured anywhere
         (no agent override AND no cascade default). The "Set STT
         provider" button opens the inline create modal so the operator
         can author their first config without bouncing to
         /settings/speech — same pattern as AgentLlmConfigModal. -->
    <div
      v-if="!loadingOverride && !agentOverride && cascadeBadge.source === 'not configured'"
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

    <!-- Dropdown row — shown whenever something is in effect (either an
         agent override or a cascade default). Mirrors AgentLlmSection's
         LLM-Config select: pick an existing config to override the
         cascade, or pick "Use cascade default" to clear the override.
         Selection saves immediately. The "+ New" button opens the inline
         create modal (see AgentSpeechConfigModal). -->
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
