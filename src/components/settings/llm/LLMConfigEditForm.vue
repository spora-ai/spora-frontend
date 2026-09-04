<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useLlmConfigsStore } from '@/stores/llmConfigs'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '@/api/client'
import ToolSettingsForm from '@/components/settings/ToolSettingsForm.vue'
import LLMConfigLimitsFields from '@/components/settings/llm/LLMConfigLimitsFields.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import Modal from '@/components/Modal.vue'
import Icon from '@/components/ui/Icon.vue'
import type { LLMConfigResource } from '@/types/llmConfig'

const props = defineProps<{
  config: LLMConfigResource
}>()

const emit = defineEmits<{
  saved: []
  deleted: []
  cancel: []
}>()

const llmStore = useLlmConfigsStore()
const authStore = useAuthStore()

const activeDriver = computed(() => llmStore.driverForClass(props.config.driver_class) ?? null)
const isAdmin = computed(() => authStore.user?.is_admin === true)
const isReadOnly = computed(() => props.config.is_global && !isAdmin.value)
const canPromote = computed(
  () => isAdmin.value && props.config.is_global && !props.config.is_default,
)
const serverSettings = ref<Record<string, string>>({ ...props.config.settings })
const initialFormLimits = {
  context_window: props.config.context_window !== null ? String(props.config.context_window) : '',
  max_tokens_output: props.config.max_tokens_output !== null ? String(props.config.max_tokens_output) : '',
}
const formLimits = ref<{ context_window: string; max_tokens_output: string }>({
  ...initialFormLimits,
})
// ToolSettingsForm owns its own Save button, gated by a dirty check that
// only sees the Settings schema fields. The Limits section lives here
// in the parent, so we surface its dirty state via `extraDirty` —
// otherwise a Limits-only edit leaves Save disabled.
const limitsDirty = computed(
  () =>
    formLimits.value.context_window !== initialFormLimits.context_window ||
    formLimits.value.max_tokens_output !== initialFormLimits.max_tokens_output,
)
const saving = ref(false)
const error = ref<string | null>(null)
const savedFlash = ref(false)
const showDeleteModal = ref(false)
const deleting = ref(false)
const promoting = ref(false)
let flashTimer: ReturnType<typeof setTimeout> | null = null
onUnmounted(() => { if (flashTimer) clearTimeout(flashTimer) })

async function onSave(settings: Record<string, string>): Promise<void> {
  error.value = null
  saving.value = true
  try {
    // Omit password fields that are still '***' (unchanged)
    const settingsToSend: Record<string, string> = {}
    for (const [key, value] of Object.entries(settings)) {
      if (serverSettings.value[key] === '***' && value === '***') continue
      settingsToSend[key] = value
    }
    const updated = await llmStore.updateConfig(props.config.id, {
      settings: settingsToSend,
      context_window: formLimits.value.context_window
        ? Number(formLimits.value.context_window)
        : undefined,
      max_tokens_output: formLimits.value.max_tokens_output
        ? Number(formLimits.value.max_tokens_output)
        : undefined,
    })
    serverSettings.value = { ...updated.settings }
    formLimits.value = {
      context_window: updated.context_window !== null ? String(updated.context_window) : '',
      max_tokens_output: updated.max_tokens_output !== null ? String(updated.max_tokens_output) : '',
    }
    savedFlash.value = true
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => { savedFlash.value = false }, 2000)
    emit('saved')
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to update configuration.'
  } finally {
    saving.value = false
  }
}

async function confirmDelete(): Promise<void> {
  deleting.value = true
  try {
    await llmStore.deleteConfig(props.config.id)
    showDeleteModal.value = false
    emit('deleted')
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to delete configuration.'
    showDeleteModal.value = false
  } finally {
    deleting.value = false
  }
}

async function promoteToDefault(): Promise<void> {
  promoting.value = true
  error.value = null
  try {
    await llmStore.setDefault(props.config.id)
    savedFlash.value = true
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => { savedFlash.value = false }, 2000)
    emit('saved')
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to set as global default.'
  } finally {
    promoting.value = false
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="mb-6">
    <button
      type="button"
      @click="emit('cancel')"
      class="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      ← All configurations
    </button>
    <h1 class="text-lg font-semibold">{{ config.name }}</h1>
    <p class="text-sm text-muted-foreground mt-0.5">{{ config.driver_display_name }}</p>
  </div>

  <AlertBanner v-if="savedFlash" type="success" message="Configuration saved." class="mb-4" />

  <!-- Read-only global config banner -->
  <AlertBanner
    v-if="isReadOnly"
    type="warning"
    message="Global configuration — available to all users. Contact your administrator to modify."
    class="mb-4"
  />

  <div v-if="activeDriver" class="rounded-xl border border-border bg-card p-5">
    <!-- Name -->
    <div class="mb-5">
      <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Name</p>
      <p class="text-sm font-medium">{{ config.name }}</p>
    </div>

    <!-- Driver -->
    <div class="mb-5">
      <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Driver</p>
      <p class="text-sm">{{ config.driver_display_name }}</p>
    </div>

    <!-- Limits -->
    <div v-if="!isReadOnly" class="mb-5">
      <LLMConfigLimitsFields v-model="formLimits" />
    </div>

    <!-- Settings -->
    <div class="mb-5">
      <h3 class="text-sm font-semibold mb-3">Settings</h3>
      <div v-if="isReadOnly" class="text-sm space-y-2">
        <div v-for="(value, key) in serverSettings" :key="key" class="flex justify-between py-1 border-b border-border">
          <span class="text-muted-foreground">{{ key }}</span>
          <span class="font-mono text-xs">{{ value === '***' ? '••••••••' : value }}</span>
        </div>
      </div>
      <ToolSettingsForm
        v-else
        :tool="{ tool_class: activeDriver.driver_class, tool_name: activeDriver.name, display_name: activeDriver.display_name, description: '', category: '', settings_schema: activeDriver.settings_schema, operations: [] }"
        :initialSettings="serverSettings"
        :saving="saving"
        :error="error"
        :extraDirty="limitsDirty"
        @save="onSave"
      />
    </div>

    <!-- Actions -->
    <div v-if="!isReadOnly" class="flex items-center justify-end gap-3 pt-4 border-t border-border">
      <span
        v-if="isAdmin && config.is_global && config.is_default"
        class="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400"
      >
        <Icon name="check-circle" class="h-3.5 w-3.5" />
        Global default
      </span>
      <button
        v-if="canPromote"
        type="button"
        @click="promoteToDefault"
        :disabled="saving || promoting"
        class="inline-flex h-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 px-3 text-sm font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
      >
        {{ promoting ? 'Promoting…' : 'Set as Global Default' }}
      </button>
      <button
        type="button"
        @click="showDeleteModal = true"
        :disabled="saving || promoting"
        class="inline-flex h-9 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 px-3 text-sm font-medium text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  </div>

  <!-- Metadata -->
  <div class="mt-4 text-xs text-muted-foreground">
    <p>Created {{ formatDate(config.created_at) }}</p>
    <p>Updated {{ formatDate(config.updated_at) }}</p>
  </div>

  <!-- Delete confirmation modal -->
  <Modal v-model="showDeleteModal" title="Delete Configuration" size="sm" :backdropClosable="!deleting">
    <p class="text-sm text-muted-foreground">
      Delete <strong class="text-foreground">{{ config.name }}</strong>? This cannot be undone.
    </p>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          @click="showDeleteModal = false"
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
</template>
