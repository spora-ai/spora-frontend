<script setup lang="ts">
/**
 * SpeechProviderConfigForm — schema-driven form for a single speech
 * provider configuration. Iterates the provider's `settings_schema` and
 * renders the right field component per `type`.
 *
 * Scope handling:
 *   - `scope: 'global' | 'user' | 'group'` — POSTs to
 *     `/api/v1/speech/provider-configs` via `store.upsert()`. When
 *     `scope === 'group'`, the caller must also pass `groupId` so the
 *     controller can authorise (group admin OR global admin) and
 *     resolve the group's principal id.
 *   - `scope: 'agent'` — writes through `useToolSettings(agentId)` to
 *     `PUT /agents/{id}/tools/{tool}/override`, which is the existing
 *     per-agent tool override endpoint. The provider class is the
 *     tool class (`Spora\Speech\OpenAiCompatibleTranscriber`). In this
 *     mode the form's `settings` map is sent as-is — `display_name`
 *     becomes a settings key on the override row.
 *
 * Password handling:
 *   - On edit, the server returns "***" for masked (unchanged) keys.
 *   - Submitting the form omits any key whose submitted value matches
 *     the "***" sentinel so the existing password is preserved
 *     (matches ToolConfigService::putGlobalSettings convention).
 *
 * Validation:
 *   - The schema field's `validation` regex (when present) is applied
 *     client-side on blur; mismatches surface inline below the field.
 */
import { ref, computed, reactive, onUnmounted, watch } from 'vue'
import { useSpeechProviderConfigsStore } from '@/stores/speechProviderConfigs'
import { useToolSettings } from '@/composables/useToolSettings'
import { ApiError } from '@/api/client'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import Modal from '@/components/Modal.vue'
import Icon from '@/components/ui/Icon.vue'
import type {
  SpeechProviderClassSchema,
  SpeechProviderConfig,
  SpeechProviderConfigSettingsSchema,
  SpeechProviderScope,
} from '@/types/speechProviderConfig'

const props = defineProps<{
  provider: SpeechProviderClassSchema
  /** Existing config (edit) — undefined when creating a new one. */
  config?: SpeechProviderConfig | null
  /** Scope to write under when creating. Ignored on edit (existing scope is kept). */
  scope: SpeechProviderScope
  /** Required when scope === 'group': the group whose principal the config targets. */
  groupId?: number
  /** Required when scope === 'agent': the agent whose tool override row this becomes. */
  agentId?: number
  /**
   * Optional override for the internal `saving` flag. The component
   * tracks its own saving state during submit, but a parent can pin
   * `saving` true to disable the form while it triggers a sibling
   * mutation (e.g. the Group page disables the edit form while it
   * refreshes the list cache).
   */
  saving?: boolean
}>()

const emit = defineEmits<{
  saved: [config: SpeechProviderConfig]
  deleted: []
  cancel: []
}>()

const store = useSpeechProviderConfigsStore()
// Lazy-create the per-agent tool settings bridge. Only meaningful when
// scope === 'agent' and agentId is set; otherwise unused. `useToolSettings`
// is a plain function (no Pinia), so calling it here without a real
// agentId would still build the bridge but no caller would call any
// methods on it.
const agentToolSettings = computed(() =>
  props.scope === 'agent' && typeof props.agentId === 'number'
    ? useToolSettings(props.agentId)
    : null,
)

// Local form state. Keys that aren't present in the schema yet still
// round-trip from the server (future schema additions, plugin fields,
// etc.) so we seed the form with the full settings map.
const configSettings = props.config?.settings
const initialValues = ref<Record<string, string>>(configSettings ? { ...configSettings } : {})
const form = reactive<Record<string, string>>({ ...initialValues.value })
const errors = reactive<Record<string, string | null>>({})
const internalSaving = ref(false)
// `saving` is the externally-visible state: own submit-in-flight OR
// the parent pin. Form widgets disable themselves on `saving`.
const saving = computed<boolean>(() => props.saving === true || internalSaving.value)
const savedFlash = ref(false)
const errorMessage = ref<string | null>(null)
const showDeleteModal = ref(false)
const deleting = ref(false)
let flashTimer: ReturnType<typeof setTimeout> | null = null
onUnmounted(() => {
  if (flashTimer !== null) clearTimeout(flashTimer)
})

// Reset the form whenever the bound config changes (e.g. user switches
// from one config to another via the sidebar without remounting the
// page). Without this the new config's settings would clobber the
// current form state — or vice versa.
watch(
  () => props.config?.id ?? null,
  () => {
    const next = props.config?.settings
    initialValues.value = next ? { ...next } : {}
    for (const key of Object.keys(form)) delete form[key]
    Object.assign(form, initialValues.value)
    for (const key of Object.keys(errors)) delete errors[key]
  },
)

const isEdit = computed(() => props.config !== null && props.config !== undefined)

function isPasswordField(field: SpeechProviderConfigSettingsSchema): boolean {
  return field.type === 'password'
}

// Passwords returned by the server come back masked. On edit, the form
// keeps the masked sentinel in the local state so we can detect
// "unchanged" on submit and skip sending the key.
function isMasked(value: string): boolean {
  return value === '***'
}

function fieldDefault(field: SpeechProviderConfigSettingsSchema): string {
  return field.default !== null && field.default !== undefined ? String(field.default) : ''
}

// PHP `#[ToolSetting(validation: ...)]` sources come wrapped in PCRE-style
// delimiters (`/^...$/`, `#^...$#`, `~^...$~`). `new RegExp(source)` would
// treat those delimiters as literal characters and reject every input.
// Strip a matching delimiter pair first; fall back to silent accept if the
// underlying regex is malformed (server-side validation surfaces the real
// error on submit).
const PCRE_DELIMITERS = '/#~<>()[]{}|,;@^%`'

function compileValidationRegex(source: string): RegExp | null {
  if (source.length >= 2) {
    const first = source[0]
    const last = source[source.length - 1]
    if (first === last && PCRE_DELIMITERS.includes(first)) {
      try {
        return new RegExp(source.slice(1, -1))
      } catch {
        return null
      }
    }
  }
  try {
    return new RegExp(source)
  } catch {
    return null
  }
}

function validateField(field: SpeechProviderConfigSettingsSchema, value: string): string | null {
  // Password fields on an existing config: an empty value means
  // "keep the existing key", not "user wants to clear it" — the user
  // has to type something (anything other than '') to actually replace it.
  // The masked `'***'` sentinel round-trip covers edit-without-change and
  // the post-`Change`-click path (the input clears to '' so the user can
  // type, but we still don't validate on the empty intermediate state).
  // `${see buildSettingsToSend()} below for the matching submission path.
  if (
    field.type === 'password'
    && isEdit.value
    && initialValues.value[field.key] === '***'
    && (value === '' || value === '***')
  ) {
    return null
  }
  if (field.required && value.trim() === '') {
    return `${field.label} is required.`
  }
  if (field.validation && value !== '') {
    const re = compileValidationRegex(field.validation)
    if (re !== null && !re.test(value)) {
      return `${field.label} is not in the expected format.`
    }
  }
  return null
}

function onBlur(field: SpeechProviderConfigSettingsSchema): void {
  const value = form[field.key] ?? ''
  errors[field.key] = validateField(field, value)
}

const isDirty = computed(() => {
  for (const [key, value] of Object.entries(form)) {
    const initial = initialValues.value[key]
    if (initial === '***') {
      // Password unchanged if user hasn't typed anything new
      if (value !== '' && value !== '***') return true
    } else if (value !== initial) {
      return true
    }
  }
  for (const [key, value] of Object.entries(initialValues.value)) {
    if (!(key in form) && value !== '***') return true
  }
  return false
})

async function submit(): Promise<void> {
  errorMessage.value = null
  if (!validateAll()) return
  const settingsToSend = buildSettingsToSend()

  internalSaving.value = true
  try {
    const saved = await persistSettings(settingsToSend)
    applyServerResult(saved)
  } catch (e) {
    errorMessage.value = e instanceof ApiError ? e.message : 'Failed to save configuration.'
  } finally {
    internalSaving.value = false
  }
}

// Validate every schema field and surface the first failure inline.
// Returns true when the form is ready to submit.
function validateAll(): boolean {
  let firstError: string | null = null
  for (const field of props.provider.settings_schema) {
    const msg = validateField(field, form[field.key] ?? '')
    errors[field.key] = msg
    if (msg !== null && firstError === null) firstError = msg
  }
  return firstError === null
}

// Strip masked "***" passwords so the server keeps the existing key.
// The settings schema is the source of truth for which keys exist today,
// so we iterate that rather than the form map (which may contain stale
// keys from a prior schema version).
function buildSettingsToSend(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of props.provider.settings_schema) {
    const value = form[field.key] ?? ''
    const initial = initialValues.value[field.key]
    if (isPasswordField(field) && initial === '***' && (value === '' || value === '***')) {
      continue
    }
    out[field.key] = value
  }
  return out
}

async function persistSettings(settingsToSend: Record<string, string>): Promise<SpeechProviderConfig> {
  // Per-agent overrides ride the existing tool override endpoint, not
  // /speech/provider-configs. The provider's settings map becomes the
  // override row's `settings` blob — no separate `display_name` column.
  if (props.scope === 'agent') {
    if (!agentToolSettings.value) {
      throw new Error('Agent id is required to save a per-agent speech override.')
    }
    const bridge = agentToolSettings.value
    const existing = isEdit.value && props.config ? props.config.settings : undefined
    const saved = await bridge.putSettings(props.provider.class, settingsToSend, existing)
    // Synthesise a SpeechProviderConfig envelope so the parent's
    // `saved` event handler can update its cache uniformly.
    const envelope: SpeechProviderConfig = {
      ...(props.config ?? {
        id: 0,
        provider_class: props.provider.class,
        provider_display_name: props.provider.display_name,
        scope: 'agent',
        display_name: settingsToSend.display_name ?? props.provider.display_name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      settings: saved,
      updated_at: new Date().toISOString(),
    }
    if (!isEdit.value) {
      envelope.display_name = settingsToSend.display_name ?? props.provider.display_name
      envelope.created_at = envelope.updated_at
    }
    return envelope
  }

  if (isEdit.value && props.config) {
    return await store.update(props.config.id, { settings: settingsToSend })
  }
  return await store.upsert({
    provider_class: props.provider.class,
    scope: props.scope,
    settings: settingsToSend,
    ...(props.scope === 'group' && typeof props.groupId === 'number'
      ? { group_id: props.groupId }
      : {}),
  })
}

function applyServerResult(saved: SpeechProviderConfig): void {
  initialValues.value = { ...saved.settings }
  Object.assign(form, saved.settings)
  for (const key of Object.keys(errors)) delete errors[key]
  savedFlash.value = true
  if (flashTimer !== null) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { savedFlash.value = false }, 2000)
  emit('saved', saved)
}

async function confirmDelete(): Promise<void> {
  if (!props.config) return
  deleting.value = true
  internalSaving.value = true
  try {
    await store.remove(props.config.id)
    showDeleteModal.value = false
    emit('deleted')
  } catch (e) {
    errorMessage.value = e instanceof ApiError ? e.message : 'Failed to delete configuration.'
    showDeleteModal.value = false
  } finally {
    deleting.value = false
    internalSaving.value = false
  }
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
    <h1 class="text-lg font-semibold">
      <template v-if="isEdit && config">
        {{ config.display_name }}
      </template>
      <template v-else>
        New {{ provider.display_name }} configuration
      </template>
    </h1>
    <p class="text-sm text-muted-foreground mt-0.5">
      {{ provider.display_name }}
    </p>
  </div>

  <AlertBanner
    v-if="savedFlash"
    type="success"
    message="Configuration saved."
    class="mb-4"
  />

  <form
    @submit.prevent="submit"
    class="rounded-xl border border-border bg-card p-5"
  >
    <div class="flex flex-col gap-4">
      <div
        v-for="field in provider.settings_schema"
        :key="field.key"
        class="flex flex-col gap-1.5"
      >
        <label
          :for="`speech-${field.key}`"
          class="text-sm font-medium"
        >
          {{ field.label }}
          <span
            v-if="field.required"
            class="text-destructive"
          >*</span>
        </label>

        <textarea
          v-if="field.type === 'textarea'"
          :id="`speech-${field.key}`"
          v-model="form[field.key]"
          @blur="onBlur(field)"
          :placeholder="fieldDefault(field) || field.description"
          :required="field.required === true"
          :disabled="saving"
          rows="3"
          autocomplete="off"
          class="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          :class="errors[field.key] !== null && errors[field.key] !== undefined ? 'border-destructive focus:ring-destructive' : ''"
        />

        <select
          v-else-if="field.type === 'select'"
          :id="`speech-${field.key}`"
          v-model="form[field.key]"
          @blur="onBlur(field)"
          :required="field.required === true"
          :disabled="saving"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          :class="errors[field.key] !== null && errors[field.key] !== undefined ? 'border-destructive focus:ring-destructive' : ''"
        >
          <option value="">
            — None —
          </option>
          <option
            v-for="opt in field.options ?? []"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>

        <label
          v-else-if="field.type === 'toggle'"
          class="flex items-center gap-2 cursor-pointer"
        >
          <input
            :id="`speech-${field.key}`"
            v-model="form[field.key]"
            type="checkbox"
            :true-value="'true'"
            :false-value="'false'"
            :disabled="saving"
            class="rounded border-border text-primary focus:ring-primary disabled:opacity-50"
          >
          <span class="text-xs text-muted-foreground">{{ field.description }}</span>
        </label>

        <!-- password: locked display + Change button, mirrors ToolSettingField -->
        <div v-else-if="field.type === 'password'">
          <div
            v-if="isEdit && isMasked(form[field.key] ?? '')"
            class="flex items-center gap-2"
          >
            <div class="flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm font-mono tracking-[0.3em] text-muted-foreground select-none">
              ••••••••
            </div>
            <button
              type="button"
              @click="form[field.key] = ''"
              class="shrink-0 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              Change
            </button>
          </div>
          <input
            v-else
            :id="`speech-${field.key}`"
            v-model="form[field.key]"
            @blur="onBlur(field)"
            :placeholder="fieldDefault(field) || field.description"
            :required="field.required === true"
            :disabled="saving"
            type="password"
            autocomplete="off"
            class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            :class="errors[field.key] !== null && errors[field.key] !== undefined ? 'border-destructive focus:ring-destructive' : ''"
          >
        </div>

        <input
          v-else
          :id="`speech-${field.key}`"
          v-model="form[field.key]"
          @blur="onBlur(field)"
          :placeholder="fieldDefault(field) || field.description"
          :required="field.required === true"
          :disabled="saving"
          type="text"
          autocomplete="off"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          :class="errors[field.key] !== null && errors[field.key] !== undefined ? 'border-destructive focus:ring-destructive' : ''"
        >

        <p
          v-if="field.description && field.type !== 'toggle'"
          class="text-xs text-muted-foreground"
        >
          {{ field.description }}
        </p>
        <p
          v-if="errors[field.key]"
          role="alert"
          class="text-xs text-destructive"
        >
          {{ errors[field.key] }}
        </p>
      </div>
    </div>

    <div class="mt-6 flex items-center justify-between gap-4">
      <p
        v-if="errorMessage"
        role="alert"
        class="text-xs text-destructive"
      >
        {{ errorMessage }}
      </p>
      <span v-else />
      <div class="flex gap-2">
        <button
          v-if="isEdit"
          type="button"
          @click="showDeleteModal = true"
          :disabled="saving || deleting"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 px-4 text-sm font-medium text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
        >
          Delete
        </button>
        <button
          type="submit"
          :disabled="!isDirty || saving"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </div>
  </form>

  <Modal
    v-if="config"
    v-model="showDeleteModal"
    title="Delete Configuration"
    size="sm"
    :backdrop-closable="!deleting"
  >
    <p class="text-sm text-muted-foreground">
      Delete <strong class="text-foreground">{{ config.display_name }}</strong>? This cannot be undone.
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
          <Icon
            v-if="deleting"
            name="loader-2"
            class="h-3.5 w-3.5 mr-1 animate-spin"
          />
          {{ deleting ? 'Deleting…' : 'Delete' }}
        </button>
      </div>
    </template>
  </Modal>
</template>
