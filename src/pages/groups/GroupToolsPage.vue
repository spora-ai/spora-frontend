<script setup lang="ts">
/**
 * GroupToolsPage — GitHub-style per-group overrides for tool settings.
 *
 * Mirrors /settings/tools (operator defaults) and /settings/admin/tools:
 * the page renders either the categorised `ToolSettingsList` or the
 * `ToolSettingsPanel` — never both at the same time. Selection is
 * keyed by `?tool=<toolName>` in the URL so back/forward navigation
 * restores the open tool and deep links work. No modal.
 *
 * `ToolSettingsPanel` runs in `mode="group"` so it does NOT call
 * `/tools/{name}/user-settings` itself — that route keys on the
 * caller's user-principal, not the group principal. The parent owns
 * the network call instead:
 *   onSaved  → POST /groups/{id}/tools/{toolClass}
 *   onCleared → DELETE /groups/{id}/tools/{toolClass}
 *
 * The row-trailing slot on the list surfaces a `Configured` chip when
 * the group has overridden a tool's defaults, mirroring the operator's
 * `Global default` indicator. Unconfigured tools are still clickable
 * — clicking opens the same editor pre-filled empty, so the group
 * owner can configure a tool for the first time without a separate
 * "Add" picker.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { ApiError, api } from '@/api/client'
import Icon from '@/components/ui/Icon.vue'
import ToolSettingsList from '@/components/settings/tools/ToolSettingsList.vue'
import ToolSettingsPanel from '@/components/settings/tools/ToolSettingsPanel.vue'
import type { ToolSchema } from '@/composables/useToolSettings'

const route = useRoute()
const router = useRouter()
const detailStore = useGroupDetailStore()
const authStore = useAuthStore()
const toast = useToast()

const groupId = computed<number>(() => detailStore.group?.id ?? 0)
const groupPrincipalId = computed<number | null>(() => detailStore.group?.principal_id ?? null)
const canEdit = computed<boolean>(() => {
  if (authStore.user?.is_admin) return true
  return detailStore.group?.my_role === 'owner' || detailStore.group?.my_role === 'admin'
})

const allTools = ref<ToolSchema[]>([])
const loadingTools = ref(false)
const loadError = ref<string | null>(null)

let toolsRequestGeneration = 0

async function loadTools(): Promise<void> {
  const gen = ++toolsRequestGeneration
  loadingTools.value = true
  loadError.value = null
  try {
    const res = await api.get<{ tools: ToolSchema[] }>('/tools')
    if (gen !== toolsRequestGeneration) return
    // Drop tools with no settings schema: nothing to configure, so they
    // would just crowd the list with unclickable rows.
    allTools.value = (res.tools ?? []).filter((t) => t.settings_schema.length > 0)
    loadingTools.value = false
  } catch (e) {
    if (gen === toolsRequestGeneration) {
      allTools.value = []
      loadError.value = e instanceof ApiError ? e.message : 'Failed to load tool registry.'
      loadingTools.value = false
    }
  }
}

const configuredToolClasses = computed<Set<string>>(
  () => new Set(detailStore.toolSettings.map((t) => t.tool_class)),
)

function isConfigured(tool: ToolSchema): boolean {
  return configuredToolClasses.value.has(tool.tool_class)
}

onMounted(async () => {
  if (groupId.value === 0) return
  try {
    await Promise.all([detailStore.fetchTools(groupId.value), loadTools()])
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to load tool settings.')
  }
})

// --- selection ---------------------------------------------------------

// selectedTool holds the ToolSchema the user opened. The URL is the
// source of truth — both watchers below keep the ref in sync with
// ?tool= in both directions, mirroring SettingsToolsPage.
const selectedTool = ref<ToolSchema | null>(null)
const saving = ref(false)

function findTool(toolName: string | undefined): ToolSchema | null {
  if (!toolName) return null
  return (
    allTools.value.find(
      (t) => t.tool_class === toolName || t.tool_name === toolName,
    ) ) ?? null
}

watch(
  () => (route.query.tool as string | undefined) ?? null,
  (toolName) => {
    selectedTool.value = findTool(toolName ?? undefined)
  },
)

watch(
  () => selectedTool.value?.tool_name ?? null,
  (toolName) => {
    const current = (route.query.tool as string | undefined) ?? null
    if (toolName === current) return
    void router.replace({
      name: 'group-tools',
      query: toolName ? { tool: toolName } : {},
    })
  },
)

// Re-evaluate the selection once the registry lands — the route
// query may have been a tool_name not yet in `allTools` when the
// page mounted.
watch(allTools, () => {
  if (selectedTool.value === null) {
    selectedTool.value = findTool((route.query.tool as string | undefined) ?? undefined)
  }
})

// --- list ↔ panel handlers ---------------------------------------------

function onSelectTool(toolName: string): void {
  // Member-only callers can browse the list but cannot open the editor —
  // mirror the operator's read-only affordance at /settings/admin/tools.
  if (!canEdit.value) return
  selectedTool.value = findTool(toolName)
}

function goBack(): void {
  selectedTool.value = null
}

const editingInitial = computed<Record<string, string>>(() => {
  if (selectedTool.value === null) return {}
  const row = detailStore.toolSettings.find(
    (t) => t.tool_class === selectedTool.value!.tool_class,
  )
  return row?.settings ?? {}
})

async function onSaved(settings: Record<string, string>): Promise<void> {
  if (selectedTool.value === null || groupId.value === 0) return
  saving.value = true
  try {
    await detailStore.upsertTool(
      groupId.value,
      selectedTool.value.tool_class,
      settings,
    )
    toast.success('Tool settings saved.')
    goBack()
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to save tool settings.')
  } finally {
    saving.value = false
  }
}

async function onCleared(): Promise<void> {
  if (selectedTool.value === null || groupId.value === 0) return
  saving.value = true
  try {
    await detailStore.deleteTool(groupId.value, selectedTool.value.tool_class)
    toast.success('Tool settings reset to defaults.')
    goBack()
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to reset tool settings.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="loadError" class="mb-4">
    <Icon name="warning" class="h-4 w-4 mr-1 text-destructive inline" />
    <span class="text-sm text-destructive">{{ loadError }}</span>
  </div>

  <div v-if="loadingTools && allTools.length === 0" class="text-sm text-muted-foreground">
    Loading…
  </div>

  <ToolSettingsPanel
    v-else-if="selectedTool !== null"
    :tool="selectedTool"
    :initial-settings="editingInitial"
    :principal-id="groupPrincipalId"
    mode="group"
    @saved="onSaved"
    @cleared="onCleared"
    @back="goBack"
  />

  <ToolSettingsList
    v-else
    :tools="allTools"
    @select="onSelectTool"
  >
    <template #row-trailing="{ tool }">
      <span
        v-if="isConfigured(tool)"
        class="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400"
      >
        <Icon name="check-circle" class="h-3.5 w-3.5" />
        Configured
      </span>
    </template>
  </ToolSettingsList>
</template>