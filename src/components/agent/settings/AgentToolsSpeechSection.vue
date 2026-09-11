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
 *   - We don't have a server-side "give me the resolved effective config
 *     for this agent" endpoint on this branch yet, so we cascade client
 *     side: agent override wins, then user, then group, then global.
 *     A future backend add (single `GET /speech/agent/{id}/effective`)
 *     would let us drop the client-side chain.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useSpeechProviderConfigsStore } from '@/stores/speechProviderConfigs'
import { useToolSettings } from '@/composables/useToolSettings'
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

type ViewMode = 'idle' | 'pick-provider' | 'edit'
const viewMode = ref<ViewMode>('idle')
const selectedProviderClass = ref<string | null>(null)
const agentOverride = ref<SpeechProviderConfig | null>(null)
const loadingOverride = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

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
    created_at: '',
    updated_at: '',
  }
}

const cascadeBadge = computed<{ label: string; tone: string; source: string }>(() => {
  if (agentOverride.value) {
    const display = agentOverride.value.display_name || agentOverride.value.provider_display_name
    return {
      label: `Using ${display} (agent override)`,
      tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
      source: 'agent override',
    }
  }
  const personal = store.personalConfigs.find((c) => c.provider_class === openAiClass)
  if (personal) {
    return {
      label: `Using ${personal.display_name || personal.provider_display_name} (user default)`,
      tone: 'bg-primary/10 text-primary',
      source: 'user default',
    }
  }
  const group = store.groupConfigs.find((c) => c.provider_class === openAiClass)
  if (group) {
    return {
      label: `Using ${group.display_name || group.provider_display_name} (group default)`,
      tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
      source: 'group default',
    }
  }
  const global = store.globalConfigs.find((c) => c.provider_class === openAiClass)
  if (global) {
    return {
      label: `Using ${global.display_name || global.provider_display_name} (global default)`,
      tone: 'bg-muted text-muted-foreground',
      source: 'global default',
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
  if (availableProviders.value.length === 1) {
    selectedProviderClass.value = availableProviders.value[0]?.class ?? null
    viewMode.value = 'edit'
  } else {
    viewMode.value = 'pick-provider'
  }
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
  await store.ensure()
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
            No speech provider override for this agent
          </p>
          <p class="text-xs text-muted-foreground">
            The agent uses the caller's personal, group, or global default.
            Set an override to pin this agent to a specific provider.
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
