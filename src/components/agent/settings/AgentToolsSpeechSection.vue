<script setup lang="ts">
/**
 * AgentToolsSpeechSection — per-agent speech-to-text provider override.
 *
 * Lives on the Agent settings page next to the LLM section. Renders:
 *   1. A cascade-source badge showing which tier is currently in effect
 *      (agent override → user default → group default → global default).
 *   2. The provider-class picker + per-class config form (reuses
 *      `SpeechProviderConfigForm` in `scope: 'agent'` mode) when the
 *      operator clicks "Set STT provider".
 *   3. An edit/remove row when an agent override exists.
 *
 * Wire shape: per-agent overrides ride the existing
 * `PUT /agents/{id}/tools/{tool}/override` endpoint — see
 * `useToolSettings(agentId)`. The provider class is the tool class
 * (`Spora\\Speech\\OpenAiCompatibleTranscriber` for the bundled STT).
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
import SpeechProviderConfigForm from '@/components/settings/speech/SpeechProviderConfigForm.vue'
import SpeechProviderConfigList from '@/components/settings/speech/SpeechProviderConfigList.vue'
import Icon from '@/components/ui/Icon.vue'
import { ApiError } from '@/api/client'
import type {
  SpeechProviderClassSchema,
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

type ViewMode = 'idle' | 'pick-provider' | 'edit'
const viewMode = ref<ViewMode>('idle')
const selectedProviderClass = ref<string | null>(null)
const agentOverride = ref<SpeechProviderConfig | null>(null)
const loadingOverride = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
// Bound to the "Provider class" dropdown on the idle row. Setter routes
// straight into edit mode so the operator doesn't have to click twice
// (once to pick, once to confirm). The "+ Add new" button on the same
// row hits startCreate() for the new-config flow.
const selectedClassForAgent = ref<string | null>(null)

const openAiClass = String.raw`Spora\Speech\OpenAiCompatibleTranscriber`

const selectedProvider = computed<SpeechProviderClassSchema | null>(() => {
  const cls = selectedProviderClass.value
  if (!cls) return null
  return store.providerByClass(cls) ?? null
})

const availableProviders = computed<SpeechProviderClassSchema[]>(() =>
  store.providers.filter((p) => p.class === openAiClass || isPluginProvider(p.class)),
)

// Only known plugin STT classes are surfaced — the bundled
// OpenAiCompatibleTranscriber is always present. Plugins register new
// classes via `Extension::speechToTextProviders()`.
function isPluginProvider(className: string): boolean {
  return className.startsWith('Spora\\Plugins\\') || className.startsWith('Spora\\Extensions\\')
}

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
    })
    .catch((e: unknown) => {
      // 404 = no override yet. Any other error is surfaced inline.
      if (e instanceof ApiError && e.status === 404) {
        agentOverride.value = null
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
    provider_display_name: provider?.display_name ?? 'Speech-to-text',
    scope: 'agent',
    display_name: settings.display_name ?? provider?.display_name ?? 'Agent override',
    settings,
    is_default: false,
    created_at: '',
    updated_at: '',
  }
}

const cascadeBadge = computed<{ label: string; tone: string; source: string }>(() => {
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
  // fallback) for ANY registered STT class — the previous client-side
  // chain only checked the bundled OpenAI class, which made the badge
  // show "global default" even when a user-scope Muse config was in use.
  const resolvedClass = capability.effectiveClass.value
  const resolvedSource = capability.effectiveSource.value
  if (resolvedClass !== null && resolvedSource !== null) {
    // Find the per-config `display_name` (operator-overridable) at the
    // tier the backend picked, falling back to the provider class's
    // class-level label, then to the FQCN itself.
    const tierConfigs = (
      resolvedSource === 'user_preference' ? store.personalConfigs
      : resolvedSource === 'group_preference' ? store.groupConfigs
      : resolvedSource === 'global_default' ? store.globalConfigs
      : []
    )
    const tierConfig = tierConfigs.find((c) => c.provider_class === resolvedClass)
    const provider = store.providerByClass(resolvedClass)
    const display =
      tierConfig?.display_name
      ?? tierConfig?.provider_display_name
      ?? provider?.display_name
      ?? resolvedClass
    if (resolvedSource === 'user_preference') {
      return {
        label: `Using ${display} (user default)`,
        tone: 'bg-primary/10 text-primary',
        source: 'user default',
      }
    }
    if (resolvedSource === 'group_preference') {
      return {
        label: `Using ${display} (group default)`,
        tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
        source: 'group default',
      }
    }
    if (resolvedSource === 'global_default') {
      return {
        label: `Using ${display} (global default)`,
        tone: 'bg-muted text-muted-foreground',
        source: 'global default',
      }
    }
    // 'fallback' — backend picked a provider via first-configured-wins
    // (e.g. the Muse plugin always reports `isConfigured === true` with
    // no stored settings). The operator has nothing pinned at any tier,
    // so label the source as "fallback" rather than the misleading
    // "global default" we used to show.
    return {
      label: `Using ${display} (fallback)`,
      tone: 'bg-muted text-muted-foreground',
      source: 'fallback',
    }
  }

  return {
    label: 'No speech provider configured',
    tone: 'bg-muted text-muted-foreground',
    source: 'not configured',
  }
})

function startCreate(): void {
  error.value = null
  // Always surface the picker grid (mirrors the LLM flow on
  // AgentLlmSection). Skipping straight to the edit form when only
  // one provider class was registered hid the "pick a class" step
  // from operators whose plugin set added a second class.
  viewMode.value = 'pick-provider'
}

function startEdit(): void {
  error.value = null
  if (agentOverride.value) {
    selectedProviderClass.value = agentOverride.value.provider_class
  } else {
    selectedProviderClass.value = openAiClass
  }
  viewMode.value = 'edit'
}

function pickProvider(provider: SpeechProviderClassSchema): void {
  selectedProviderClass.value = provider.class
  viewMode.value = 'edit'
}

function applyClassToAgent(): void {
  if (!selectedClassForAgent.value) return
  error.value = null
  selectedProviderClass.value = selectedClassForAgent.value
  viewMode.value = 'edit'
}

function cancel(): void {
  selectedProviderClass.value = null
  viewMode.value = 'idle'
  error.value = null
}

async function onSaved(config: SpeechProviderConfig): Promise<void> {
  agentOverride.value = config
  viewMode.value = 'idle'
  selectedProviderClass.value = null
  error.value = null
}

async function onDeleted(): Promise<void> {
  agentOverride.value = null
  viewMode.value = 'idle'
  selectedProviderClass.value = null
  error.value = null
}

async function removeOverride(): Promise<void> {
  if (!agentOverride.value) return
  saving.value = true
  error.value = null
  try {
    // The agent tool override endpoint is the same one that writes
    // settings — deleting clears the row. There is no separate DELETE
    // for agent overrides; `deleteSettings` from useToolSettings calls
    // `DELETE /agents/{id}/tools/{tool}/override`.
    await agentToolSettings.deleteSettings(openAiClass)
    await loadAgentOverride()
    if (!agentOverride.value) {
      viewMode.value = 'idle'
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to remove agent override.'
  } finally {
    saving.value = false
  }
}

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

    <!-- Idle view: list existing override (single row) or show the empty CTA -->
    <div
      v-if="viewMode === 'idle'"
      class="px-5 py-4"
    >
      <!-- "Provider class" dropdown + Apply + Add new — surfaced when
           there's no existing override. Mirrors AgentLlmSection's
           LLM-Config select + New-button row. Apply short-circuits the
           picker grid (the class is already chosen), Add new jumps to
           the picker for new-config creation. Hidden once an override
           exists: the existing-row list below already shows the
           configured class. -->
      <div
        v-if="!agentOverride"
        class="flex items-center justify-between gap-3 mb-4"
      >
        <div class="flex-1">
          <label
            for="agent-speech-class"
            class="text-xs font-medium text-muted-foreground"
          >
            Provider class
          </label>
          <select
            id="agent-speech-class"
            v-model="selectedClassForAgent"
            class="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            data-testid="agent-speech-class-select"
          >
            <option
              :value="null"
              disabled
            >
              — Pick a provider class —
            </option>
            <option
              v-for="p in availableProviders"
              :key="p.class"
              :value="p.class"
            >
              {{ p.display_name }}
            </option>
          </select>
        </div>
        <div class="flex flex-col gap-2 shrink-0">
          <button
            type="button"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
            :disabled="!selectedClassForAgent"
            data-testid="agent-speech-apply-class"
            @click="applyClassToAgent"
          >
            Apply
          </button>
          <button
            type="button"
            class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            data-testid="agent-speech-add-new"
            @click="startCreate"
          >
            + Add new
          </button>
        </div>
      </div>

      <div
        v-if="loadingOverride"
        class="text-sm text-muted-foreground"
      >
        Loading…
      </div>

      <SpeechProviderConfigList
        v-else-if="agentOverride"
        :scope="('agent' as SpeechProviderScope)"
        :items="[agentOverride]"
        @select="startEdit"
        @create="startCreate"
      />

      <div
        v-else-if="cascadeBadge.source !== 'not configured'"
        class="px-5 py-3 flex items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <span>
          No agent override — currently using the cascade default.
        </span>
        <button
          type="button"
          data-testid="agent-speech-create"
          class="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
          @click="startCreate"
        >
          <Icon
            name="plus"
            class="h-3.5 w-3.5 mr-1"
          />
          Override
        </button>
      </div>

      <div
        v-else
        class="rounded-xl border border-dashed border-border bg-muted/30 p-6 flex flex-col items-center text-center gap-3"
      >
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
          @click="startCreate"
        >
          <Icon
            name="plus"
            class="h-4 w-4 mr-1.5"
          />
          Set STT provider
        </button>
      </div>
    </div>

    <!-- Provider-class picker -->
    <div
      v-else-if="viewMode === 'pick-provider'"
      class="px-5 py-4"
    >
      <button
        type="button"
        class="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        @click="cancel"
      >
        ← Cancel
      </button>
      <h3 class="text-sm font-semibold mb-3">
        Pick a provider class
      </h3>
      <div
        v-if="availableProviders.length === 0"
        class="text-sm text-muted-foreground"
      >
        No speech provider classes are registered.
      </div>
      <div
        v-else
        class="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        <button
          v-for="provider in availableProviders"
          :key="provider.class"
          type="button"
          class="rounded-xl border border-border bg-card p-4 text-left hover:border-primary/50 hover:bg-muted/50 transition-colors"
          @click="pickProvider(provider)"
        >
          <p class="text-sm font-semibold">
            {{ provider.display_name }}
          </p>
          <p class="text-xs text-muted-foreground mt-1 font-mono break-all">
            {{ provider.class }}
          </p>
        </button>
      </div>
    </div>

    <!-- Edit form -->
    <div
      v-else-if="viewMode === 'edit' && selectedProvider"
      class="px-5 py-4"
    >
      <SpeechProviderConfigForm
        :key="`${selectedProvider.class}-${agentOverride?.updated_at ?? 'new'}`"
        :provider="selectedProvider"
        :config="agentOverride"
        scope="agent"
        :agent-id="agentId"
        @saved="onSaved"
        @deleted="onDeleted"
        @cancel="cancel"
      />
      <div
        v-if="agentOverride"
        class="mt-4 flex items-center justify-end gap-3 pt-4 border-t border-border"
      >
        <button
          type="button"
          data-testid="agent-speech-remove"
          :disabled="saving"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 px-3 text-sm font-medium text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
          @click="removeOverride"
        >
          Remove override
        </button>
      </div>
    </div>
  </section>
</template>
