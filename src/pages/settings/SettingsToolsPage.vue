<script setup lang="ts">
import { ref, computed, inject, watch } from 'vue'
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

const selectedTool = computed<ToolSchema | null>(
  () => allTools.value.find((t) => t.tool_name === (route.query.tool as string | undefined)) ?? null,
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

function goBack(): void {
  const next = { ...route.query }
  delete next.tool
  router.replace({ query: next })
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
  />
</template>
