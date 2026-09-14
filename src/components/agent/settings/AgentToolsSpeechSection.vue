<script setup lang="ts">
/**
 * AgentToolsSpeechSection — per-agent speech-to-text provider override.
 *
 * Each agent can pick an existing speech config (user / group / global)
 * to override the cascade, or leave the cascade default in place. The
 * `+ New` button opens an inline create modal — same UX as
 * `AgentLlmConfigModal` — so the operator does not have to bounce to
 * /settings/speech to author their first config. The agent override
 * itself is a config pointer, not a free-form editor.
 *
 * Wire shape: per-agent overrides ride the existing
 * `PUT /agents/{id}/tools/{tool}/override` endpoint — see
 * `useToolSettings(agentId)`. The provider class is the tool class
 * (`Spora\\Speech\\OpenAiCompatibleTranscriber` for the bundled STT).
 * Selecting a config writes its settings into the agent override row;
 * picking "Use cascade default" deletes the row and the cascade falls
 * through to user → group → global.
 *
 * Cascade derivation:
 *   - Tier 1 (agent override on this specific agent) is computed
 *     locally from `agentOverride`, which is read from the per-agent
 *     tool override endpoint.
 *   - Tiers 2-5 (user preference → group preference → global default →
 *     fallback) come from the capability endpoint's resolved
 *     `effective_class` + `effective_source` — the backend walks the
 *     cascade for us, so the badge always reflects the actual class
 *     that will be used (and works for any registered STT class,
 *     not just the bundled OpenAI-compatible one).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useSpeechProviderConfigsStore } from '@/stores/speechProviderConfigs'
import { useToolSettings } from '@/composables/useToolSettings'
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
}

const props = defineProps<{
  agent: Agent
  agentId: number
}>()

 const store = useSpeechProviderConfigsStore()
const agentToolSettings = useToolSettings(props.agentId)
// Cascade tier 2-5 (user preference → group preference → global default
// → fallback) comes from the capability endpoint's resolved class +
// source. Tier 1 (agent override) is the local `agentOverride` ref.
const capability = useSpeechCapability()
const toast = useToast()

const agentOverride = ref<SpeechProviderConfig | null>(null)
const loadingOverride = ref(false)
const error = ref<string | null>(null)
const selectedConfigId = ref<number | null>(null)
// Mirrors the last value `selectedConfigId` was synced to (either from
// a fresh load or from a successful save). The watcher compares the
// incoming value against this to skip the synthetic write triggered by
// initial-load initialisation.
const lastPersistedConfigId = ref<number | null>(null)
const showCreate = ref(false)

const openAiClass = String.raw`Spora\Speech\OpenAiCompatibleTranscriber`

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

function loadAgentOverride(): Promise<void> {
  loadingOverride.value = true
  return agentToolSettings
    .getSettings(openAiClass)
    .then((settings) => {
      const trimmed: Record<string, string> = {}
      for (const [k, v] of Object.entries(settings)) {
        if (v !== null && v !== undefined) trimmed[k] = String(v)
      }
      const hasContent = Object.keys(trimmed).length > 0
      if (hasContent) {
        agentOverride.value = synthAgentConfig(trimmed)
      } else {
        agentOverride.value = null
      }
      syncSelectedConfigFromOverride()
    })
    .catch((e: unknown) => {
      // 404 = no override yet. Any other error is surfaced inline.
      if (e instanceof ApiError && e.status === 404) {
        agentOverride.value = null
        syncSelectedConfigFromOverride()
        return
      }
      error.value = e instanceof Error ? e.message : 'Failed to load agent override.'
    })
    .finally(() => {
      loadingOverride.value = false
    })
}

function synthAgentConfig(settings: Record<string, string>): SpeechProviderConfig {
  const provider = store.providerByClass(openAiClass)
  return {
    id: 0,
    provider_class: openAiClass,
    provider_name: provider?.display_name ?? 'Speech-to-text',
    provider_display_name: provider?.display_name ?? 'Speech-to-text',
    scope: 'agent',
    display_name: settings.display_name ?? provider?.display_name ?? 'Agent override',
    settings,
    is_default: false,
    is_global: false,
    principal_id: null,
    created_at: '',
    updated_at: '',
  }
}

// Resolve `selectedConfigId` from the freshly-loaded override. Best-effort:
// pick the first config whose `provider_class` matches the override's
// class. When nothing matches (e.g. the operator deleted the config the
// override was copied from), `selectedConfigId` is null and the badge
// remains the source of truth for what is currently in effect.
function syncSelectedConfigFromOverride(): void {
  if (!agentOverride.value) {
    selectedConfigId.value = null
  } else {
    const match = availableConfigs.value.find(
      (c) => c.provider_class === agentOverride.value!.provider_class,
    )
    selectedConfigId.value = match?.id ?? null
  }
  lastPersistedConfigId.value = selectedConfigId.value
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

// Save the operator's dropdown choice. `null` deletes the override;
// any other id writes the config's settings into the agent override row.
// Existing settings are passed through so `putSettings` can preserve
// masked password values.
async function persistConfigSelection(configId: number | null): Promise<void> {
  error.value = null
  if (configId === null) {
    if (!agentOverride.value) return
    try {
      await agentToolSettings.deleteSettings(openAiClass)
      agentOverride.value = null
      toast.success('Agent speech override removed.')
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to remove agent override.'
      // Roll the dropdown back to the previous selection so the UI
      // reflects the server's truth.
      selectedConfigId.value = lastPersistedConfigId.value
    }
    return
  }

  const config = availableConfigs.value.find((c) => c.id === configId)
  if (!config) return
  try {
    // Settings arrive masked (`api_key: '***'`) from the list endpoint
    // — see the component docblock for the rationale. The existing
    // `putSettings` flow already handles masked fields; we just pass
    // them through.
    await agentToolSettings.putSettings(
      openAiClass,
      config.settings,
      agentOverride.value?.settings,
    )
    agentOverride.value = synthAgentConfig(config.settings)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to save agent override.'
    selectedConfigId.value = lastPersistedConfigId.value
  }
}

watch(selectedConfigId, (newId) => {
  if (newId === lastPersistedConfigId.value) return
  void persistConfigSelection(newId).then(() => {
    lastPersistedConfigId.value = selectedConfigId.value
  })
})

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

// Re-fetch when the agent prop changes (e.g. navigating between agents
// without unmounting the page).
watch(
  () => props.agentId,
  async () => {
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
