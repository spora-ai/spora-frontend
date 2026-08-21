<script setup lang="ts">
/**
 * GroupToolsPage — GitHub-style per-group overrides for tool settings.
 *
 * Reuses the operator's `ToolSettingsList` (categorised collapsible list)
 * and `ToolSettingsPanel` (the same form operator admins see at
 * /settings/admin/tools). The only divergence: the panel is opened in
 * `mode="group"` so it does NOT call `/tools/{name}/user-settings`
 * itself — that route keys on the caller's user-principal, not the
 * group principal. The parent owns the network call instead:
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
import { useGroupDetailStore } from '@/stores/groupDetail'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { ApiError, api } from '@/api/client'
import Modal from '@/components/Modal.vue'
import Icon from '@/components/ui/Icon.vue'
import ToolSettingsList from '@/components/settings/tools/ToolSettingsList.vue'
import ToolSettingsPanel from '@/components/settings/tools/ToolSettingsPanel.vue'
import type { ToolSchema } from '@/composables/useToolSettings'

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

async function loadTools(): Promise<void> {
  loadingTools.value = true
  try {
    const res = await api.get<{ tools: ToolSchema[] }>('/tools')
    // Drop tools with no settings schema: nothing to configure, so they
    // would just crowd the list with unclickable rows.
    allTools.value = (res.tools ?? []).filter((t) => t.settings_schema.length > 0)
  } catch {
    allTools.value = []
  } finally {
    loadingTools.value = false
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

const editing = ref<string | null>(null)
const saving = ref(false)

const editingTool = computed<ToolSchema | null>(() => {
  if (editing.value === null) return null
  return (
    allTools.value.find(
      (t) => t.tool_class === editing.value || t.tool_name === editing.value,
    ) ?? null
  )
})

const editingInitial = computed<Record<string, string>>(() => {
  if (editing.value === null) return {}
  const row = detailStore.toolSettings.find((t) => t.tool_class === editing.value)
  return row?.settings ?? {}
})

watch(editingTool, (tool) => {
  if (
    tool !== null &&
    editing.value !== null &&
    !tool.tool_class.startsWith(editing.value) &&
    tool.tool_name !== editing.value
  ) {
    // Some plugins register tool_class ≠ tool_name; align so the
    // detail delete call uses the same key the list endpoint chose.
    editing.value = tool.tool_name
  }
})

function onSelectTool(toolName: string): void {
  // Member-only callers can browse the list but cannot open the editor —
  // mirror the operator's read-only affordance at /settings/admin/tools.
  if (!canEdit.value) return
  editing.value = toolName
}

function closeEdit(): void {
  editing.value = null
}

async function onSaved(settings: Record<string, string>): Promise<void> {
  if (editing.value === null || groupId.value === 0) return
  saving.value = true
  try {
    await detailStore.upsertTool(groupId.value, editing.value, settings)
    toast.success('Tool settings saved.')
    closeEdit()
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to save tool settings.')
  } finally {
    saving.value = false
  }
}

async function onCleared(): Promise<void> {
  if (editing.value === null || groupId.value === 0) return
  saving.value = true
  try {
    await detailStore.deleteTool(groupId.value, editing.value)
    toast.success('Tool settings reset to defaults.')
    closeEdit()
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to reset tool settings.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <h1 class="text-lg font-semibold">Tool Settings</h1>
      <p class="text-sm text-muted-foreground mt-0.5">
        Per-tool configuration overrides scoped to this group.
      </p>
    </div>

    <div v-if="loadingTools && allTools.length === 0" class="text-sm text-muted-foreground">
      Loading…
    </div>

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

    <Modal
      v-if="editingTool"
      :modelValue="editing !== null"
      @update:modelValue="(v: boolean) => { if (!v) closeEdit() }"
      :title="editingTool.display_name ?? editingTool.tool_name"
      size="lg"
    >
      <ToolSettingsPanel
        :tool="editingTool"
        :initial-settings="editingInitial"
        :principal-id="groupPrincipalId"
        mode="group"
        @saved="onSaved"
        @cleared="onCleared"
        @back="closeEdit"
      />
      <template #footer>
        <div class="flex justify-end">
          <button
            type="button"
            @click="closeEdit"
            class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Close
          </button>
        </div>
      </template>
    </Modal>
  </div>
</template>