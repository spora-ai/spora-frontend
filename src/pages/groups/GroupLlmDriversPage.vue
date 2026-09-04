<script setup lang="ts">
/**
 * GroupLlmDriversPage — CRUD on llm_driver_configurations rows scoped to the group.
 *
 * Mirrors the admin /llm-configs page layout (list + create + edit
 * dialog) but every action hits the per-group endpoints so principal_id
 * is set on the server. Drivers are loaded once from the personal
 * /llm-drivers endpoint to seed the create form's driver picker.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { useLlmConfigsStore } from '@/stores/llmConfigs'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { ApiError } from '@/api/client'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/Modal.vue'
import LLMConfigLimitsFields from '@/components/settings/llm/LLMConfigLimitsFields.vue'
import ToolSettingsForm from '@/components/settings/ToolSettingsForm.vue'
import type { LLMConfigResource } from '@/types/llmConfig'

const detailStore = useGroupDetailStore()
const llmStore = useLlmConfigsStore()
const authStore = useAuthStore()
const toast = useToast()

const groupId = computed<number>(() => detailStore.group?.id ?? 0)
const canEdit = computed<boolean>(() => {
  if (authStore.user?.is_admin) return true
  return detailStore.group?.my_role === 'owner' || detailStore.group?.my_role === 'admin'
})

onMounted(async () => {
  if (groupId.value === 0) return
  try {
    await Promise.all([
      detailStore.fetchLlmConfigs(groupId.value),
      detailStore.fetchPreferences(groupId.value),
      llmStore.loadDrivers(),
    ])
  } catch (e) {
    // 404 on preferences is benign — the row simply hasn't been created yet.
    if (!(e instanceof ApiError) || e.status !== 404) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load LLM configurations.')
    }
  }
})

const configs = computed<LLMConfigResource[]>(() => detailStore.llmConfigs as unknown as LLMConfigResource[])

const preferredLlmId = computed<number | null>(() => detailStore.preferences?.preferred_llm_config_id ?? null)
const preferredLlmDisplay = computed<string>(() => {
  const id = preferredLlmId.value
  if (id === null) return 'No default set — agents will fall back to global default.'
  const match = configs.value.find((c) => c.id === id)
  if (!match) return `Config #${id} (no longer exists)`
  return `${match.name} — ${match.driver_display_name}`
})
const preferredSaving = ref(false)
const draftPreferredId = ref<number | null>(preferredLlmId.value)
watch(
  [preferredLlmId, configs],
  ([id]) => {
    draftPreferredId.value = id
  },
  { immediate: true },
)
async function savePreferred(): Promise<void> {
  await choosePreferred(draftPreferredId.value)
}
async function clearPreferred(): Promise<void> {
  draftPreferredId.value = null
  await choosePreferred(null)
}
async function choosePreferred(id: number | null): Promise<void> {
  if (groupId.value === 0) return
  preferredSaving.value = true
  try {
    await detailStore.upsertPreferences(groupId.value, { preferred_llm_config_id: id })
    toast.success(id === null ? 'Group default cleared.' : 'Group default updated.')
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to save group default.')
  } finally {
    preferredSaving.value = false
  }
}

type Mode = 'list' | 'create' | 'edit'
const mode = ref<Mode>('list')
const selectedId = ref<number | null>(null)
const selected = computed<LLMConfigResource | null>(
  () => configs.value.find((c) => c.id === selectedId.value) ?? null,
)

const deleting = ref(false)
const showDelete = ref(false)
const saving = ref(false)
const savedFlash = ref(false)
let flashTimer: ReturnType<typeof setTimeout> | null = null

function startCreate(): void {
  mode.value = 'create'
  selectedId.value = null
}

function startEdit(config: LLMConfigResource): void {
  mode.value = 'edit'
  selectedId.value = config.id
}

function cancel(): void {
  mode.value = 'list'
  selectedId.value = null
}

function activeDriverForConfig(config: LLMConfigResource) {
  return llmStore.driverForClass(config.driver_class) ?? null
}

function activeDriverForCreate() {
  return llmStore.drivers[0] ?? null
}

const createForm = ref<{
  name: string
  driverClass: string
  settings: Record<string, string>
  limits: { context_window: string; max_tokens_output: string }
  isDefault: boolean
}>({
  name: '',
  driverClass: '',
  settings: {},
  limits: { context_window: '', max_tokens_output: '' },
  isDefault: false,
})

function onDriverChange(): void {
  const driver = llmStore.drivers.find((d) => d.driver_class === createForm.value.driverClass)
  if (!driver) return
  const defaults: Record<string, string> = {}
  for (const field of driver.settings_schema) {
    if (field.default !== undefined && field.default !== null) {
      defaults[field.key] = String(field.default)
    }
  }
  createForm.value.settings = defaults
}

async function submitCreate(settings: Record<string, string>): Promise<void> {
  if (groupId.value === 0 || !createForm.value.name.trim() || !createForm.value.driverClass) return
  saving.value = true
  try {
    const created = await detailStore.createLlmConfig(groupId.value, {
      name: createForm.value.name.trim(),
      driver_class: createForm.value.driverClass,
      settings,
      context_window: createForm.value.limits.context_window
        ? Number(createForm.value.limits.context_window)
        : undefined,
      max_tokens_output: createForm.value.limits.max_tokens_output
        ? Number(createForm.value.limits.max_tokens_output)
        : undefined,
      is_default: createForm.value.isDefault,
    })
    toast.success('LLM configuration created.')
    startEdit(created as unknown as LLMConfigResource)
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to create configuration.')
  } finally {
    saving.value = false
  }
}

const editForm = ref<{
  limits: { context_window: string; max_tokens_output: string }
  serverSettings: Record<string, string>
}>({
  limits: { context_window: '', max_tokens_output: '' },
  serverSettings: {},
})

function seedEditForm(config: LLMConfigResource): void {
  editForm.value = {
    limits: {
      context_window: config.context_window !== null ? String(config.context_window) : '',
      max_tokens_output: config.max_tokens_output !== null ? String(config.max_tokens_output) : '',
    },
    serverSettings: { ...config.settings },
  }
}

function beginEdit(config: LLMConfigResource): void {
  startEdit(config)
  seedEditForm(config)
}

async function submitEdit(settings: Record<string, string>): Promise<void> {
  if (groupId.value === 0 || selected.value === null) return
  saving.value = true
  try {
    const toSend: Record<string, string> = {}
    for (const [key, value] of Object.entries(settings)) {
      if (editForm.value.serverSettings[key] === '***' && value === '***') continue
      toSend[key] = value
    }
    await detailStore.updateLlmConfig(groupId.value, selected.value.id, {
      settings: toSend,
      context_window: editForm.value.limits.context_window
        ? Number(editForm.value.limits.context_window)
        : undefined,
      max_tokens_output: editForm.value.limits.max_tokens_output
        ? Number(editForm.value.limits.max_tokens_output)
        : undefined,
    })
    savedFlash.value = true
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => { savedFlash.value = false }, 2000)
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to update configuration.')
  } finally {
    saving.value = false
  }
}

async function confirmDelete(): Promise<void> {
  if (groupId.value === 0 || selected.value === null) return
  deleting.value = true
  try {
    await detailStore.deleteLlmConfig(groupId.value, selected.value.id)
    toast.success('LLM configuration deleted.')
    showDelete.value = false
    cancel()
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to delete configuration.')
  } finally {
    deleting.value = false
  }
}

async function setDefault(): Promise<void> {
  if (groupId.value === 0 || selected.value === null) return
  saving.value = true
  try {
    await detailStore.setDefaultLlmConfig(groupId.value, selected.value.id)
    savedFlash.value = true
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => { savedFlash.value = false }, 2000)
    await detailStore.fetchLlmConfigs(groupId.value)
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to set default.')
  } finally {
    saving.value = false
  }
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="mode === 'list'">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h1 class="text-lg font-semibold">LLM Drivers</h1>
          <p class="text-sm text-muted-foreground mt-0.5">
            LLM configurations scoped to this group.
          </p>
        </div>
        <button
          v-if="canEdit"
          type="button"
          @click="startCreate"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        >
          <Icon name="plus" class="h-4 w-4 mr-1.5" />
          Add Configuration
        </button>
      </div>

      <div class="rounded-xl border border-border bg-card p-5">
        <div class="flex items-start gap-3 mb-3">
          <Icon name="sparkles" class="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold">Preferred LLM for this group</div>
            <p class="text-xs text-muted-foreground mt-0.5">
              Agents owned by this group use this configuration by default, unless they override it themselves.
            </p>
          </div>
        </div>

        <div v-if="!canEdit" class="text-sm text-foreground">
          {{ preferredLlmDisplay }}
        </div>
        <div v-else class="flex items-center gap-2">
          <label class="flex-1">
            <span class="sr-only">Preferred LLM configuration</span>
            <select
              v-model.number="draftPreferredId"
              :disabled="preferredSaving"
              class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            >
              <option :value="null">— No group default —</option>
              <option
                v-for="config in configs"
                :key="config.id"
                :value="config.id"
              >
                {{ config.name }} — {{ config.driver_display_name }}
              </option>
            </select>
          </label>
          <button
            type="button"
            @click="savePreferred"
            :disabled="preferredSaving || draftPreferredId === preferredLlmId"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {{ preferredSaving ? 'Saving…' : 'Save' }}
          </button>
          <button
            v-if="preferredLlmId !== null"
            type="button"
            @click="clearPreferred"
            :disabled="preferredSaving"
            class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>

      <div v-if="configs.length === 0" class="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
        <p class="text-sm text-muted-foreground">No LLM configurations for this group yet.</p>
      </div>

      <div v-else class="rounded-xl border border-border bg-card divide-y divide-border">
        <div
          v-for="config in configs"
          :key="config.id"
          class="flex items-center justify-between px-5 py-4 transition-colors"
          :class="canEdit ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default'"
          @click="canEdit && beginEdit(config)"
        >
          <div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{{ config.name }}</span>
              <span
                v-if="config.is_default"
                class="text-xs rounded-full bg-primary/10 text-primary px-1.5 py-0.5 font-medium"
              >
                Default
              </span>
            </div>
            <p class="text-xs text-muted-foreground mt-0.5">{{ config.driver_display_name }}</p>
          </div>
          <Icon v-if="canEdit" name="chevron-right" class="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </div>

    <div v-else-if="mode === 'create'">
      <button
        type="button"
        @click="cancel"
        class="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        ← All configurations
      </button>
      <h1 class="text-lg font-semibold">New LLM Configuration</h1>
      <p class="text-sm text-muted-foreground mt-0.5 mb-4">
        Create a new LLM provider configuration for this group.
      </p>

      <div class="rounded-xl border border-border bg-card p-5">
        <div class="mb-5">
          <label for="group-llm-name" class="block text-sm font-medium mb-1.5">Name</label>
          <input
            id="group-llm-name"
            v-model="createForm.name"
            type="text"
            placeholder="Group OpenAI"
            autocomplete="off"
            class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div class="mb-5">
          <label for="group-llm-driver" class="block text-sm font-medium mb-1.5">Driver</label>
          <select
            id="group-llm-driver"
            v-model="createForm.driverClass"
            @change="onDriverChange"
            class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">— Select a driver —</option>
            <option v-for="driver in llmStore.drivers" :key="driver.name" :value="driver.driver_class">
              {{ driver.display_name }} ({{ driver.name }})
            </option>
          </select>
        </div>
        <div class="mb-5">
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              v-model="createForm.isDefault"
              class="rounded border-border text-primary focus:ring-primary"
            />
            <span class="text-sm font-medium">Set as group default</span>
          </label>
        </div>
        <div class="mb-5">
          <LLMConfigLimitsFields v-model="createForm.limits" />
        </div>
        <div v-if="createForm.driverClass">
          <h3 class="text-sm font-semibold mb-3">Settings</h3>
          <ToolSettingsForm
            v-if="activeDriverForCreate()"
            :tool="{
              tool_class: activeDriverForCreate()!.driver_class,
              tool_name: activeDriverForCreate()!.name,
              display_name: activeDriverForCreate()!.display_name,
              description: '',
              category: '',
              settings_schema: activeDriverForCreate()!.settings_schema,
              operations: [],
            }"
            :initialSettings="createForm.settings"
            :saving="saving"
            :error="null"
            @save="submitCreate"
          />
        </div>
      </div>
    </div>

    <div v-else-if="mode === 'edit' && selected">
      <button
        type="button"
        @click="cancel"
        class="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        ← All configurations
      </button>
      <h1 class="text-lg font-semibold">{{ selected.name }}</h1>
      <p class="text-sm text-muted-foreground mt-0.5">{{ selected.driver_display_name }}</p>

      <div v-if="savedFlash" role="alert" class="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
        Saved.
      </div>

      <div v-if="activeDriverForConfig(selected)" class="mt-4 rounded-xl border border-border bg-card p-5">
        <div class="mb-5">
          <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Name</p>
          <p class="text-sm font-medium">{{ selected.name }}</p>
        </div>
        <div class="mb-5">
          <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Driver</p>
          <p class="text-sm">{{ selected.driver_display_name }}</p>
        </div>
        <div class="mb-5">
          <LLMConfigLimitsFields v-model="editForm.limits" />
        </div>
        <div class="mb-5">
          <h3 class="text-sm font-semibold mb-3">Settings</h3>
          <ToolSettingsForm
            :tool="{
              tool_class: activeDriverForConfig(selected)!.driver_class,
              tool_name: activeDriverForConfig(selected)!.name,
              display_name: activeDriverForConfig(selected)!.display_name,
              description: '',
              category: '',
              settings_schema: activeDriverForConfig(selected)!.settings_schema,
              operations: [],
            }"
            :initialSettings="editForm.serverSettings"
            :saving="saving"
            :error="null"
            @save="submitEdit"
          />
        </div>
        <div class="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <button
            type="button"
            @click="showDelete = true"
            :disabled="saving"
            class="inline-flex h-9 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 px-3 text-sm font-medium text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
          >
            Delete
          </button>
          <button
            v-if="!selected.is_default"
            type="button"
            @click="setDefault"
            :disabled="saving"
            class="inline-flex h-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 px-3 text-sm font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            Set as Default
          </button>
        </div>
      </div>

      <div class="mt-4 text-xs text-muted-foreground">
        <p>Created {{ formatDate(selected.created_at) }}</p>
        <p>Updated {{ formatDate(selected.updated_at) }}</p>
      </div>

      <Modal v-model="showDelete" title="Delete Configuration" size="sm" :backdrop-closable="!deleting">
        <p class="text-sm text-muted-foreground">
          Delete <strong class="text-foreground">{{ selected.name }}</strong>? This cannot be undone.
        </p>
        <template #footer>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              @click="showDelete = false"
              :disabled="deleting"
              class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              @click="confirmDelete"
              :disabled="deleting"
              class="inline-flex h-9 items-center justify-center rounded-lg bg-destructive px-4 text-sm font-medium text-white shadow transition-colors hover:bg-destructive/90 disabled:opacity-50"
            >
              {{ deleting ? 'Deleting…' : 'Delete' }}
            </button>
          </div>
        </template>
      </Modal>
    </div>
  </div>
</template>
