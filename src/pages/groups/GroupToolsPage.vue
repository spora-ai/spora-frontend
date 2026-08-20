<script setup lang="ts">
/**
 * GroupToolsPage — list tool_user_settings rows scoped to the group.
 *
 * The "Add tool settings" affordance lets group owners configure tools the
 * group hasn't overridden yet (the list endpoint only returns existing
 * rows). Edit/Delete operate on existing rows. The settings panel now
 * distinguishes save (`@saved`) from clear-to-defaults (`@cleared`) so we
 * route deletes to `DELETE /groups/{id}/tools/{toolClass}` instead of
 * upserting back the row we just deleted.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { ApiError, api } from '@/api/client'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/Modal.vue'
import ToolSettingsPanel from '@/components/settings/tools/ToolSettingsPanel.vue'
import type { ToolSchema } from '@/composables/useToolSettings'

const detailStore = useGroupDetailStore()
const authStore = useAuthStore()
const toast = useToast()

const groupId = computed<number>(() => detailStore.group?.id ?? 0)
const canEdit = computed<boolean>(() => {
  if (authStore.user?.is_admin) return true
  return detailStore.group?.my_role === 'owner' || detailStore.group?.my_role === 'admin'
})

const allTools = ref<ToolSchema[]>([])
const loadingTools = ref(false)
const addPickerOpen = ref(false)

async function loadTools(): Promise<void> {
  loadingTools.value = true
  try {
    const res = await api.get<{ tools: ToolSchema[] }>('/tools')
    allTools.value = res.tools ?? []
  } catch {
    allTools.value = []
  } finally {
    loadingTools.value = false
  }
}

const configuredToolClasses = computed<Set<string>>(() => {
  return new Set(detailStore.toolSettings.map((t) => t.tool_class))
})

const addableTools = computed<ToolSchema[]>(() => {
  return allTools.value.filter((t) => !configuredToolClasses.value.has(t.tool_class))
})

onMounted(async () => {
  if (groupId.value === 0) return
  try {
    await Promise.all([
      detailStore.fetchTools(groupId.value),
      loadTools(),
    ])
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to load tool settings.')
  }
})

const editing = ref<string | null>(null)
const saving = ref(false)
const deleting = ref<string | null>(null)

const editingTool = computed<ToolSchema | null>(() => {
  if (editing.value === null) return null
  return allTools.value.find((t) => t.tool_class === editing.value || t.tool_name === editing.value) ?? null
})

const editingInitial = computed<Record<string, string>>(() => {
  if (editing.value === null) return {}
  const row = detailStore.toolSettings.find((t) => t.tool_class === editing.value)
  return row?.settings ?? {}
})

watch(editingTool, (tool) => {
  if (tool !== null && editing.value !== null && !tool.tool_class.startsWith(editing.value) && tool.tool_name !== editing.value) {
    // Fallback: tool_class and tool_name differ in some plugins; allow
    // editing to proceed by aligning to the tool's tool_name.
    editing.value = tool.tool_name
  }
})

function openEdit(toolClass: string): void {
  editing.value = toolClass
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

async function confirmDelete(toolClass: string): Promise<void> {
  if (groupId.value === 0) return
  deleting.value = toolClass
  try {
    await detailStore.deleteTool(groupId.value, toolClass)
    toast.success('Tool settings removed.')
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to remove tool settings.')
  } finally {
    deleting.value = null
  }
}

function startAdd(toolClass: string): void {
  addPickerOpen.value = false
  editing.value = toolClass
}

function previewSettings(toolClass: string): string {
  const row = detailStore.toolSettings.find((t) => t.tool_class === toolClass)
  if (!row) return ''
  const entries = Object.entries(row.settings)
  if (entries.length === 0) return 'No settings configured'
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v.length > 16 ? v.slice(0, 13) + '…' : v}`)
    .join(', ')
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

    <div v-if="loadingTools && detailStore.toolSettings.length === 0" class="text-sm text-muted-foreground">Loading…</div>

    <div v-else-if="detailStore.toolSettings.length === 0" class="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
      <Icon name="tools" class="h-6 w-6 text-muted-foreground mx-auto mb-2" />
      <p class="text-sm font-medium mb-1">No tool settings configured for this group.</p>
      <p class="text-xs text-muted-foreground">
        Pick a tool to configure its overrides for this group. Each tool inherits the global default unless overridden here.
      </p>
    </div>

    <div v-else class="rounded-xl border border-border overflow-x-scroll">
      <table class="w-full text-sm">
        <thead class="bg-muted/40">
          <tr>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground">Tool</th>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground">Settings</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="row in detailStore.toolSettings" :key="row.tool_class">
            <td class="px-4 py-3 font-medium">{{ row.tool_class }}</td>
            <td class="px-4 py-3 text-muted-foreground font-mono text-xs">{{ previewSettings(row.tool_class) }}</td>
            <td class="px-4 py-3">
              <div v-if="canEdit" class="flex items-center gap-1 justify-end">
                <button
                  type="button"
                  @click="openEdit(row.tool_class)"
                  class="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-muted transition-colors"
                >
                  Edit
                </button>
                <button
                  type="button"
                  @click="confirmDelete(row.tool_class)"
                  :disabled="deleting === row.tool_class"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                  title="Delete settings"
                >
                  <Icon name="trash" class="h-4 w-4" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="canEdit" class="flex justify-end">
      <div class="relative">
        <button
          type="button"
          @click="addPickerOpen = !addPickerOpen"
          :disabled="addableTools.length === 0"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon name="plus" class="h-4 w-4 mr-1.5" />
          Add tool settings
        </button>
        <div
          v-if="addPickerOpen"
          class="absolute right-0 mt-2 w-72 max-h-72 overflow-y-auto rounded-lg border border-border bg-background shadow-lg z-10"
        >
          <div v-if="addableTools.length === 0" class="px-4 py-3 text-sm text-muted-foreground">
            Every available tool is already configured for this group.
          </div>
          <ul v-else class="py-1">
            <li v-for="tool in addableTools" :key="tool.tool_class">
              <button
                type="button"
                @click="startAdd(tool.tool_class)"
                class="w-full flex flex-col items-start px-3 py-2 text-left hover:bg-muted transition-colors"
              >
                <span class="text-sm font-medium">{{ tool.display_name ?? tool.tool_name }}</span>
                <span class="text-xs text-muted-foreground font-mono">{{ tool.tool_class }}</span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <Modal v-if="editingTool" :modelValue="editing !== null" @update:modelValue="(v: boolean) => { if (!v) closeEdit() }" :title="editingTool.display_name ?? editingTool.tool_name" size="lg">
      <ToolSettingsPanel
        :tool="editingTool"
        :initial-settings="editingInitial"
        mode="user"
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
