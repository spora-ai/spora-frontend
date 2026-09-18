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
  principal?: { type?: 'user' | 'group' | string; group_id?: number | null } | null
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

// Per-agent slot: `?agent_id=N` already narrows by the agent's
// principal (user or group) so the slot holds exactly the configs this
// operator can pick for this agent — no cross-principal bleed when the
// operator navigates between agents in the same session.
const slot = computed(() => store.getSlot(props.agentId))

// Tier-1 override: a synthesised view onto the actual config row the
// FK points at. Settings live on the FK row, not on this ref.
const agentOverride = computed<SpeechProviderConfig | null>(() => {
  const id = agentStore.currentAgent?.speech_driver_config_id ?? null
  if (id === null) return null
  return slot.value.configs.find((c) => c.id === id) ?? null
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
// operator picks one of these. The slot is already principal-scoped
// (server-side `?agent_id=N` filter), so the three sub-lists come from
// filtering that single scoped array rather than three unscoped ones.
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

// Tier 1 of the cascade is the agent's `speech_driver_config_id` FK —
// re-read from the store's `currentAgent` whenever the agent row
// updates (PATCH response, fetch on mount, sibling writes). No
// dedicated network call: the agent page already loaded the agent
// row, and PATCH responses carry the canonical value back so the
// store mirrors the truth.
//
// When no FK is set, fall through to the user/group preference loaded
// into `slot.preferredSpeech` by `loadPreferenceFor()` — the dropdown
// stays at the operator's selected "default" instead of "Use cascade
// default", which read in the original screenshot as "user/group
// default". The persistence watcher below turns any change into a
// PATCH round-trip so the FK reflects the dropdown's chosen value.
function syncSelectedConfigFromOverride(): void {
  const fkId = agentStore.currentAgent?.speech_driver_config_id ?? null
  if (fkId !== null) {
    // If the FK points at a config the local cache hasn't loaded
    // (e.g. group-only config the user can no longer see), surface a
    // "Config no longer visible" note and let the dropdown fall back to
    // "Use cascade default" — the operator can then clear the FK.
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

  // No tier-1 override — pre-select the user's (or group's) preferred
  // config so the dropdown mirrors the cascade badge. The preference
  // is loaded by `loadPreferenceFor()` based on the agent's principal
  // type, so a group-owned agent pre-selects the group's preferred
  // config and a user-owned agent pre-selects the user's. Only
  // pre-select when the preferred config is actually in the scoped
  // dropdown — otherwise fall back to "Use cascade default".
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

// Holds the FK id when it points at a config row the current operator
// cannot see (group-scoped config after leaving the group, deleted
// config the cache hasn't refreshed yet, etc.). The dropdown shows
// "Use cascade default" but the operator still needs to know the FK is
// armed — otherwise selecting the cascade default would silently
// overwrite a config they can't preview.
const unmatchedFkId = ref<number | null>(null)

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
 * in `effective_source`) to the matching config slice. Tier 1 is the
 * local `agentOverride` — handled separately in `cascadeBadge` below —
 * but tiers 2-4 each pull from the same principal-scoped slot, and
 * 'fallback' has no list (the backend picked first-configured-wins).
 * Pulling this out of the computed keeps `cascadeBadge` branch-free
 * and avoids the nested-ternary that Sonar flagged.
 */
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
// `upsert()` no longer refreshes the cache (caller-driven refresh is
// the contract — see store `upsert` docs), so we re-fetch the agent's
// slot here so the new row is in the dropdown the moment the modal
// closes. The watcher on `selectedConfigId` then writes the FK to the
// freshly-loaded row.
async function onSpeechCreated(config: SpeechProviderConfig): Promise<void> {
  // Refresh both the configs cache (so the new row appears) and the
  // schema (`loadProviders`) so the picker dropdown used by the create
  // modal reflects any newly-registered STT class. Without the second
  // fetch the dropdown stays stale — `store.providers` is fetched
  // once in `store.ensure()` and never refreshed on user actions.
  await Promise.all([
    store.loadConfigsFor(props.agentId, props.agentId),
    store.loadProviders(),
  ])
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
  // Scope the dropdown to the agent's principal: pass `agentId` so
  // `GET /api/v1/speech/provider-configs?agent_id=N` returns only
  // configs valid for this agent (user-principal or group-principal
  // configs + global), instead of every config the caller can see
  // across all their groups. The store keys this fetch under
  // `props.agentId` so a navigation to a different agent loads into a
  // fresh slot and doesn't pollute this one.
  //
  // The capability refresh also takes `agentId` so the badge reflects
  // the agent's principal — a group-owned agent shows "group default"
  // (or "global default" / "fallback"), not the caller's user-principal
  // preference. Without this, the badge was a per-user value that
  // didn't track the agent's ownership.
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

// Re-sync when the agent prop changes (e.g. navigating between agents
// without unmounting the page). The new `props.agentId` is the cache
// key — a different id means a different principal scope, so the slot
// for the new key must be loaded (the previous slot stays untouched).
// The capability endpoint depends on the agent too, so refresh it
// against the new id; the agent row itself is already loaded by the
// parent page and flows through `currentAgent`.
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

    <!-- Empty state — shown only when nothing is configured anywhere AND
         there's nothing for the operator to pick from the dropdown
         (no agent override AND no cascade default AND no configs in
         the slot's `availableConfigs`). The "Set STT provider" button
         opens the inline create modal so the operator can author their
         first config without bouncing to /settings/speech — same
         pattern as AgentLlmConfigModal.

         Previously the empty state rendered whenever the cascade
         said "not configured", even when the operator had a usable
         config on a different principal they controlled (e.g. a group
         they belong to). The dropdown was hidden behind the empty
         state, so the operator couldn't pick an override even though
         one was available. The added `availableConfigs.length > 0`
         guard lets the dropdown render in that case so the operator
         sees the available config and can pick it. -->
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
