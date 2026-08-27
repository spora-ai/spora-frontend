<script setup lang="ts">
/**
 * ToolSettingsForm — renders a complete settings form driven purely by the backend schema.
 *
 * Props:
 *   tool            — ToolSchema with settings_schema[] from GET /tools
 *   initialSettings — Record<key, value> currently saved on the server
 *   saving          — whether a save is in-flight
 *   error           — last save error message
 *
 * Emits:
 *   save(settings: Record<string, string>) — parent calls API and passes back updated serverSettings
 *   saved() — emitted when save succeeds (for flash message in parent)
 *
 * Password handling:
 *   - initialSettings contains "***" for masked (unchanged) password fields
 *   - If user clears a password that was "***", the composable sends "" (clear)
 *   - If user leaves "***" untouched, the field is omitted from the save payload (no-overwrite)
 */
import { ref, computed, watch } from 'vue'
import ToolSettingField from './ToolSettingField.vue'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import type { ToolSchema } from '@/composables/useToolSettings'

const { confirm } = useConfirmDialog()

const props = defineProps<{
  tool: ToolSchema
  initialSettings: Record<string, string>
  saving: boolean
  error: string | null
  globalDefaults?: Record<string, string>
  canClearToGlobal?: boolean
  mode?: 'global' | 'user' | 'group'
  /**
   * OR-in a caller-owned dirty signal. The Save button stays disabled
   * while this form's own fields are untouched, but the parent may
   * carry sibling inputs (e.g. the Limits section in LLMConfigEditForm)
   * whose dirty state this form can't see. Passing `true` enables Save
   * even when this form's fields are pristine.
   */
  extraDirty?: boolean
  /**
   * Forwarded to <ToolSettingField> so multi-select pickers with a
   * `data_source` (e.g. HandoverTool's `allowed_target_agents`) can be
   * scoped to the source principal. The Handover tool's intra-principal
   * picker only lists agents owned by the same principal; when the
   * caller knows the source principal, threading it down here avoids
   * surfacing foreign agents.
   */
  principalId?: number | null
}>()

const emit = defineEmits<{
  save: [settings: Record<string, string>]
  saved: []
  'clear-to-global': []
}>()

// Local form state: every value is transported as a string (multi-select
// stores its array as a JSON-encoded string, matching the field's emit).
// Decoding happens lazily in the field via JSON.parse, not here.
const form = ref<Record<string, string>>({})

function hasGlobalDefault(key: string): boolean {
  const val = props.globalDefaults?.[key]
  return val !== undefined && val !== ''
}

function globalDefaultValue(key: string): string {
  return props.globalDefaults?.[key] ?? ''
}

function isPasswordField(key: string): boolean {
  return props.tool.settings_schema.find((f) => f.key === key)?.type === 'password' || false
}

// Returns the placeholder value for a field when it inherits from a parent layer.
// Non-password: shows the parent value as hint.
// Password: returns undefined (never show parent password value).
function parentPlaceholder(key: string): string | undefined {
  const parentVal = props.globalDefaults?.[key]
  if (!parentVal) return undefined
  if (isPasswordField(key)) return undefined
  return `e.g. ${parentVal}`
}

// Multi-select values are stored in the form as JSON-encoded strings;
// the field component parses them on read. We deliberately do NOT
// decode-and-re-type the values here, because agents (`number[]`) and
// skills (`string[]`) need different coercions and the field already
// knows which `data_source` it is bound to.
function decodeSettings(settings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(settings)) {
    out[key] = value
  }
  return out
}

// Sync form when initialSettings prop changes (e.g. after save completes)
watch(
  () => props.initialSettings,
  (settings) => {
    form.value = decodeSettings(settings)
  },
  { immediate: true },
)

// Dirty = form differs from initialSettings OR the parent signals that a
// sibling input is dirty. For password fields, "***" in initialSettings
// means "masked / unchanged" — treat as equal to ''.
const isDirty = computed(() => {
  if (props.extraDirty === true) {
    return true
  }
  for (const [key, value] of Object.entries(form.value)) {
    const initial = props.initialSettings[key]
    if (initial === '***') {
      // Password unchanged if user hasn't typed anything new
      if (value !== '' && value !== '***') return true
    } else if (value !== initial) {
      return true
    }
  }
  // Also true if form has a new key initialSettings doesn't have
  for (const [key, value] of Object.entries(props.initialSettings)) {
    if (!(key in form.value) && value !== '***') return true
  }
  return false
})

function reset(): void {
  form.value = decodeSettings(props.initialSettings)
}

async function confirmClear(): Promise<void> {
  const isGlobal = props.mode === 'global'
  const message = isGlobal
    ? 'This will delete the global default settings for all fields. Users will no longer have any defaults from this tool.'
    : 'This will delete your overrides and restore the global default settings for all fields.'
  const confirmed = await confirm(message, 'Delete settings?')
  if (confirmed) emit('clear-to-global')
}

async function submit(): Promise<void> {
  // Multi-select values are already JSON-encoded strings (the field
  // emits JSON; the form stores it as-is). Pass through.
  const payload: Record<string, string> = {}
  for (const [key, value] of Object.entries(form.value)) {
    payload[key] = value
  }
  emit('save', payload)
}
</script>

<template>
  <form @submit.prevent="submit" class="flex flex-col gap-5">
    <!-- Fields -->
    <div class="flex flex-col gap-4">
      <div v-for="field in tool.settings_schema" :key="field.key">
        <ToolSettingField
          :modelValue="form[field.key] ?? ''"
          :field="field"
          :customPlaceholder="parentPlaceholder(field.key)"
          :principalId="principalId"
          @update:modelValue="form[field.key] = String($event ?? '')"
        />
        <p v-if="hasGlobalDefault(field.key)" class="text-xs text-muted-foreground mt-1">
          Global default:
          <span v-if="isPasswordField(field.key)" class="font-mono tracking-widest">••••••••</span>
          <span v-else class="font-mono">{{ globalDefaultValue(field.key) }}</span>
        </p>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-between gap-4">
      <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
      <span v-else />
      <div class="flex gap-2">
        <button
          type="button"
          @click="reset"
          :disabled="!isDirty || saving"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
        >
          Discard changes
        </button>
        <button
          v-if="props.canClearToGlobal"
          type="button"
          @click="confirmClear"
          :disabled="saving"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
        >
          Delete settings
        </button>
        <button
          type="submit"
          :disabled="!isDirty || saving"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </div>
  </form>
</template>
