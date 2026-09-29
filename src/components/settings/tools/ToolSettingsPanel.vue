<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useToolSettings } from '@/composables/useToolSettings'
import { useAuthStore } from '@/stores/auth'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { usePrincipalsStore } from '@/stores/principals'
import { ApiError } from '@/api/client'
import ToolSettingsForm from '@/components/settings/ToolSettingsForm.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import { Icon } from '@spora-ai/components/icons'
import type { ToolSchema, ToolSettingSchema } from '@/composables/useToolSettings'
import {
  displayValue as formatDisplayValue,
  diffFromGlobalDefaults,
  hasExistingSettings as checkHasExisting,
  countNonEmptySettings as countNonEmpty,
  llmExposedFields as filterLlmExposed,
  resolveMode,
} from '@/composables/useToolSettingsPanel'

const props = defineProps<{
  tool: ToolSchema
  initialSettings?: Record<string, string>
  globalDefaults?: Record<string, string>
  /**
   * `global` writes to `/tools/{name}/settings`, `user` to
   * `/tools/{name}/user-settings`. `group` only emits `saved` / `cleared` —
   * the parent owns the network call, so the panel can be reused against
   * per-group endpoints without a second request hitting the user route.
   */
  mode?: 'global' | 'user' | 'group'
  /**
   * Source principal forwarded to <ToolSettingField> so `data_source`
   * pickers (e.g. HandoverTool's `allowed_target_agents`) scope to the same
   * principal. When omitted, derived from `mode` + the matching Pinia store.
   */
  principalId?: number | null
}>()

const emit = defineEmits<{
  saved: [settings: Record<string, string>]
  cleared: [settings: Record<string, string>]
  back: []
}>()

const { getGlobalSettings, getUserSettings, putUserSettings, putSettings, deleteSettings, deleteUserSettings } = useToolSettings()
const authStore        = useAuthStore()
const groupDetailStore = useGroupDetailStore()
const principalsStore  = usePrincipalsStore()

const mode = computed(() => resolveMode(props.mode))

/**
 * Effective principal for the current mode: the explicit prop, else the
 * caller's user-principal row, else the group's, else `null` (global has no
 * principal context). The consuming page loads the store before mount, so the
 * row is usually populated — otherwise the picker's fallback URL applies.
 */
const effectivePrincipalId = computed<number | null>(() => {
  if (props.principalId !== undefined && props.principalId !== null) {
    return props.principalId
  }
  if (mode.value === 'user') {
    const callerId = authStore.user?.id
    return principalsStore.principals.find(
      (p) => p.type === 'user' && p.user_id === callerId,
    )?.id ?? null
  }
  if (mode.value === 'group') {
    return groupDetailStore.group?.principal_id ?? null
  }
  return null
})

/**
 * Settings visible at the current mode. Global hides `principal` and `agent`
 * pickers: `fetchAgentNameMap` resolves names against the source agent's
 * principal, and there is no source agent at admin scope.
 */
const visibleFields = computed<ToolSettingSchema[]>(() => {
  if (mode.value === 'global') {
    return props.tool.settings_schema.filter((f) => (f.scope ?? 'any') === 'any')
  }
  if (mode.value === 'user' || mode.value === 'group') {
    return props.tool.settings_schema.filter((f) => {
      const scope = f.scope ?? 'any'
      return scope === 'any' || scope === 'principal'
    })
  }
  // Future mode: render everything rather than silently hide.
  return props.tool.settings_schema
})

const serverSettings = ref<Record<string, string>>({ ...props.initialSettings })
const saving = ref(false)
const clearing = ref(false)
const error = ref<string | null>(null)
const savedFlash = ref(false)
const clearedFlash = ref(false)
let savedTimer: ReturnType<typeof setTimeout> | null = null
let clearedTimer: ReturnType<typeof setTimeout> | null = null
onUnmounted(() => {
  if (savedTimer) clearTimeout(savedTimer)
  if (clearedTimer) clearTimeout(clearedTimer)
})

const hasExistingSettings = computed(() => checkHasExisting(serverSettings.value))

const llmExposedFields = computed(() => filterLlmExposed(props.tool))

const settingsCount = computed(() => countNonEmpty(serverSettings.value))

async function loadSettings(): Promise<void> {
  const id = ++loadId
  let result: Record<string, string>
  if (mode.value === 'group') {
    // Group mode: the parent owns the data layer, and `initialSettings`
    // already holds the group's saved settings. Re-fetching here would clobber
    // them with the operator's global defaults — a leak between subjects.
    return
  }
  if (mode.value === 'user') {
    result = await getUserSettings(props.tool.tool_name)
  } else {
    result = await getGlobalSettings(props.tool.tool_name)
  }
  // Ignore if a newer request has already completed
  if (id !== loadId) return
  serverSettings.value = result
}

let loadId = 0
onMounted(loadSettings)

watch(() => props.tool.tool_name, loadSettings)

async function onSave(settings: Record<string, string>): Promise<void> {
  saving.value = true
  error.value = null
  try {
    if (mode.value === 'group') {
      // Parent owns the HTTP layer here — deliberately no putUserSettings,
      // which is the legacy per-user route, not the per-group one.
      emit('saved', settings)
      savedFlash.value = true
      if (savedTimer) clearTimeout(savedTimer)
      savedTimer = setTimeout(() => { savedFlash.value = false }, 2000)
      return
    }
    if (mode.value === 'user') {
      // Diff against global defaults: only send values that differ from global
      const toSave = diffFromGlobalDefaults(settings, props.globalDefaults)
      serverSettings.value = await putUserSettings(props.tool.tool_name, toSave)
    } else {
      serverSettings.value = await putSettings(props.tool.tool_name, settings, serverSettings.value)
    }
    savedFlash.value = true
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => { savedFlash.value = false }, 2000)
    emit('saved', serverSettings.value)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to save settings.'
  } finally {
    saving.value = false
  }
}

async function onClearToGlobal(): Promise<void> {
  clearing.value = true
  error.value = null
  try {
    if (mode.value === 'group') {
      emit('cleared', serverSettings.value)
      clearedFlash.value = true
      if (clearedTimer) clearTimeout(clearedTimer)
      clearedTimer = setTimeout(() => { clearedFlash.value = false }, 2000)
      return
    }
    if (mode.value === 'user') {
      await deleteUserSettings(props.tool.tool_name)
      serverSettings.value = await getUserSettings(props.tool.tool_name)
    } else {
      await deleteSettings(props.tool.tool_name)
      serverSettings.value = await getGlobalSettings(props.tool.tool_name)
    }
    clearedFlash.value = true
    if (clearedTimer) clearTimeout(clearedTimer)
    clearedTimer = setTimeout(() => { clearedFlash.value = false }, 2000)
    emit('cleared', serverSettings.value)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to reset settings.'
  } finally {
    clearing.value = false
  }
}

function displayValue(key: string, value: string): string {
  return formatDisplayValue(props.tool, key, value)
}

// Swaps in the mode-filtered schema so `ToolSettingsForm` stays unaware of
// scope filtering.
const filteredTool = computed<ToolSchema>(() => ({
  ...props.tool,
  settings_schema: visibleFields.value,
}))
</script>

<template>
  <button
    type="button"
    @click="emit('back')"
    class="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
  >
    ← All tools
  </button>

  <AlertBanner
    v-if="savedFlash"
    type="success"
    message="Settings saved."
    class="mb-4"
  />
  <AlertBanner
    v-else-if="clearedFlash"
    type="success"
    message="Settings deleted."
    class="mb-4"
  />

  <!-- Current configuration (collapsible) -->
  <div
    v-if="hasExistingSettings"
    class="mb-4"
  >
    <details class="rounded-lg border border-border bg-muted/30">
      <summary class="cursor-pointer px-4 py-2.5 text-sm font-medium text-muted-foreground select-none flex items-center justify-between">
        <span>Current Configuration ({{ settingsCount }} saved)</span>
        <Icon
          name="chevron-down"
          class="h-4 w-4 text-muted-foreground/60"
        />
      </summary>
      <div class="px-4 pb-3 pt-2 space-y-2">
        <div
          v-for="field in visibleFields"
          :key="field.key"
          class="flex items-center justify-between text-xs"
        >
          <span class="text-muted-foreground">{{ field.label }}:</span>
          <span class="font-mono text-muted-foreground/80">
            {{ displayValue(field.key, serverSettings[field.key] ?? '') }}
          </span>
        </div>
      </div>
    </details>
  </div>

  <!-- LLM Capabilities -->
  <div
    v-if="llmExposedFields.length > 0"
    class="mb-4"
  >
    <div class="rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div class="flex items-center gap-1.5 mb-2">
        <Icon
          name="sparkles"
          class="h-3.5 w-3.5 text-primary"
        />
        <h3 class="text-sm font-medium text-foreground">
          LLM Capabilities
        </h3>
      </div>
      <p class="text-xs text-muted-foreground mb-3">
        These settings directly influence how the LLM uses this tool.
      </p>
      <div class="space-y-2">
        <div
          v-for="field in llmExposedFields"
          :key="field.key"
          class="flex items-start justify-between gap-4 text-sm"
        >
          <div class="flex-1">
            <span class="font-medium text-foreground">{{ field.label }}</span>
            <p class="text-xs text-muted-foreground mt-0.5">
              {{ field.description }}
            </p>
          </div>
          <span class="shrink-0 font-mono text-xs text-muted-foreground/80 text-right min-w-[80px]">
            {{ displayValue(field.key, serverSettings[field.key] ?? '') }}
          </span>
        </div>
      </div>
    </div>
  </div>

  <div class="rounded-xl border border-border bg-card p-5">
    <h2 class="text-base font-semibold mb-1">
      {{ tool.display_name || tool.tool_name }}
    </h2>
    <p
      v-if="tool.description"
      class="text-sm text-muted-foreground mb-4"
    >
      {{ tool.description }}
    </p>
    <ToolSettingsForm
      :tool="filteredTool"
      :initial-settings="serverSettings"
      :global-defaults="globalDefaults"
      :can-clear-to-global="mode === 'user' || mode === 'global' || mode === 'group'"
      :saving="saving || clearing"
      :error="error"
      :mode="mode"
      :principal-id="effectivePrincipalId"
      @save="onSave"
      @clear-to-global="onClearToGlobal"
    />
  </div>
</template>
