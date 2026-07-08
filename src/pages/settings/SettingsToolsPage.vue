<script setup lang="ts">
import { ref, computed, inject, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToolSettings } from '@/composables/useToolSettings'
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

const selectedTool = ref<ToolSchema | null>(null)

function findTool(toolName: string | undefined): ToolSchema | null {
  if (!toolName) return null
  return allTools.value.find((t) => t.tool_name === toolName) ?? null
}

onMounted(() => {
  selectedTool.value = findTool(route.query.tool as string | undefined)
})

watch(
  () => route.query.tool,
  (toolName) => {
    if (!toolName) {
      if (selectedTool.value !== null) selectedTool.value = null
      return
    }
    const match = findTool(toolName as string)
    if (selectedTool.value?.tool_name !== toolName) {
      selectedTool.value = match
    }
  },
)

const configurableTools = computed(() =>
  allTools.value.filter((t) => t.settings_schema.length > 0),
)

const globalDefaults = ref<Record<string, string>>({})
const loadError = ref<string | null>(null)

watch(
  () => selectedTool.value?.tool_name ?? null,
  async (toolName) => {
    if (!toolName) {
      globalDefaults.value = {}
      loadError.value = null
      return
    }
    loadError.value = null
    try {
      globalDefaults.value = await getGlobalSettings(toolName)
    } catch {
      globalDefaults.value = {}
      loadError.value = 'Failed to load global default settings.'
    }
  },
  { immediate: true },
)

function onSelectTool(toolName: string): void {
  const match = findTool(toolName)
  selectedTool.value = match
  router.replace({ name: 'settings-tools', query: { tool: toolName } })
}

function goBack(): void {
  selectedTool.value = null
  router.replace({ name: 'settings-tools' })
}
</script>

<template>
  <div v-if="loadingTools" class="text-sm text-muted-foreground">Loading…</div>

  <template v-else-if="selectedTool">
    <AlertBanner v-if="loadError" type="error" :message="loadError" class="mb-4" />
    <ToolSettingsPanel
      :tool="selectedTool"
      :globalDefaults="globalDefaults"
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
