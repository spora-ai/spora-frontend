<script setup lang="ts">
import { ref, computed, inject, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToolSettings } from '@/composables/useToolSettings'
import { usePrincipalsStore } from '@/stores/principals'
import ToolSettingsPanel from '@/components/settings/tools/ToolSettingsPanel.vue'
import ToolSettingsList from '@/components/settings/tools/ToolSettingsList.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import type { ToolSchema } from '@/composables/useToolSettings'
import type { Ref } from 'vue'

const route = useRoute()
const router = useRouter()

const { allTools, loadingTools } = inject('settingsTools') as {
  allTools: Ref<ToolSchema[]>
  loadingTools: Ref<boolean>
}

const { getGlobalSettings } = useToolSettings()
const principalsStore = usePrincipalsStore()

onMounted(() => {
  // Preload the principal list so <ToolSettingsPanel>'s derived
  // `effectivePrincipalId` (mode='user') finds the caller's user-
  // principal on first render — without this, the multi-select picker
  // would briefly fetch an unfiltered list until the store resolves.
  // The load is best-effort: a failure falls back to the panel's
  // unfiltered default endpoint until the next mount resolves it.
  if (principalsStore.principals.length === 0) {
    principalsStore.load().catch(() => {})
  }
})

const selectedTool = ref<ToolSchema | null>(null)

function findTool(toolName: string | undefined): ToolSchema | null {
  if (!toolName) return null
  return allTools.value.find((t) => t.tool_name === toolName) ?? null
}

// The URL is the single source of truth for the open tool, so a deep
// link, the sidebar submenu and browser Back all resolve through this one
// watcher.
//
// `allTools` is a watch source because the registry lands *after* this
// page mounts: `GlobalSettingsLayout` fetches `/tools` in its own
// `onMounted`, which Vue runs after the child's. Resolving the query
// once on mount therefore raced that fetch, and a cold load of
// /settings/tools?tool=media (refresh, bookmark, deep link) silently
// fell back to the list with no way back in but a second click.
watch(
  [() => (typeof route.query.tool === 'string' ? route.query.tool : undefined), allTools],
  ([toolName]) => {
    selectedTool.value = findTool(toolName)
  },
  { immediate: true },
)

const configurableTools = computed(() =>
  allTools.value.filter((t) => t.settings_schema.length > 0),
)

const globalDefaults = ref<Record<string, string>>({})
const loadError = ref<string | null>(null)

// Monotonic counter incremented on every selection change. The async
// fetch can resolve out of order if the user switches tools quickly;
// the check below discards the response of any fetch that has been
// superseded by a newer one.
let defaultsRequestGeneration = 0

watch(
  () => selectedTool.value?.tool_name ?? null,
  async (toolName) => {
    const gen = ++defaultsRequestGeneration
    if (!toolName) {
      globalDefaults.value = {}
      loadError.value = null
      return
    }
    loadError.value = null
    try {
      const result = await getGlobalSettings(toolName)
      if (gen !== defaultsRequestGeneration) return
      globalDefaults.value = result
    } catch {
      if (gen !== defaultsRequestGeneration) return
      globalDefaults.value = {}
      loadError.value = 'Failed to load global default settings.'
    }
  },
  { immediate: true },
)

function onSelectTool(toolName: string): void {
  // Set the ref before the `replace` so the panel paints on this tick;
  // the watcher above then re-resolves it from the route, which is the
  // source of truth.
  selectedTool.value = findTool(toolName)
  router.replace({ name: 'settings-tools', query: { tool: toolName } })
}

function goBack(): void {
  selectedTool.value = null
  router.replace({ name: 'settings-tools' })
}
</script>

<template>
  <div
    v-if="loadingTools"
    class="text-sm text-muted-foreground"
  >
    Loading…
  </div>

  <template v-else-if="selectedTool">
    <AlertBanner
      v-if="loadError"
      type="error"
      :message="loadError"
      class="mb-4"
    />
    <ToolSettingsPanel
      :tool="selectedTool"
      :global-defaults="globalDefaults"
      mode="user"
      @back="goBack"
    />
  </template>

  <ToolSettingsList
    v-else
    title="Tool Settings"
    subtitle="Select a tool to configure its default settings."
    :tools="configurableTools"
    @select="onSelectTool"
  />
</template>
