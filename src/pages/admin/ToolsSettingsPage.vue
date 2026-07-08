<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import { useAdminAuth } from '@/composables/useAdminAuth'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminForbidden from '@/components/admin/AdminForbidden.vue'
import ToolSettingsPanel from '@/components/settings/tools/ToolSettingsPanel.vue'
import ToolSettingsList from '@/components/settings/tools/ToolSettingsList.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import Icon from '@/components/ui/Icon.vue'
import type { ToolSchema } from '@/composables/useToolSettings'

const route = useRoute()
const router = useRouter()

const { isAdmin } = useAdminAuth()
const store = useGlobalSettingsStore()

const selectedTool = computed<ToolSchema | null>(
  () => store.allTools.find((t) => t.tool_name === (route.query.tool as string | undefined)) ?? null,
)

const configurableTools = computed(() =>
  store.allTools.filter((t) => t.settings_schema.length > 0),
)

function hasGlobalSettings(tool: ToolSchema): boolean {
  const settings = store.toolSettings[tool.tool_name]
  return settings !== undefined && Object.values(settings).some((v) => v !== '' && v !== null)
}

function goBack(): void {
  const next = { ...route.query }
  delete next.tool
  router.replace({ query: next })
}

onMounted(async () => {
  await store.loadTools()
  await store.loadToolSettings()
})
</script>

<template>
  <AdminForbidden v-if="!isAdmin" />

  <AdminSection v-else title="Tool Defaults" description="Configure global default settings for all tools.">
    <AlertBanner v-if="store.toolError" type="error" :message="store.toolError" class="mb-4" />

    <div v-if="store.loadingTools" class="text-sm text-muted-foreground">Loading tools…</div>

    <ToolSettingsPanel
      v-else-if="selectedTool"
      :tool="selectedTool"
      mode="global"
      @back="goBack"
    />

    <ToolSettingsList v-else :tools="configurableTools">
      <template #row-trailing="{ tool }">
        <span
          v-if="hasGlobalSettings(tool)"
          class="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400"
        >
          <Icon name="check-circle" class="h-3.5 w-3.5" />
          Global default
        </span>
      </template>
    </ToolSettingsList>
  </AdminSection>
</template>
