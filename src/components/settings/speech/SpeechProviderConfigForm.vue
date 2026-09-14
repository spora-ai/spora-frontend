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
import { useAdminAuth } from '@/composables/useAdminAuth'
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
const { isAdmin } = useAdminAuth()
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
// etc.) so we seed the form with the full settings map. For new configs
// the schema's defaults are pre-filled so an operator who only sets the
// API key still saves a row with sensible `base_url` / `model` values
// instead of empty strings clobbering the provider's class-level
// constants.
function seedInitialValues(): Record<string, string> {
  const seeded: Record<string, string> = { ...(props.config?.settings ?? {}) }
  if (props.config === null || props.config === undefined) {
    for (const field of props.provider.settings_schema) {
      if (
        seeded[field.key] === undefined
        && field.default !== null
        && field.default !== undefined
        && field.default !== ''
      ) {
        seeded[field.key] = String(field.default)
      }
    }
  }
  return seeded
}
const initialValues = ref<Record<string, string>>(seedInitialValues())
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
    initialValues.value = seedInitialValues()
    for (const key of Object.keys(form)) delete form[key]
    Object.assign(form, initialValues.value)
    for (const key of Object.keys(errors)) delete errors[key]
  },
)

const isEdit = computed(() => props.config !== null && props.config !== undefined)

// "Set as Global Default" is admin-only and global-scope-only, and only
// makes sense on existing rows (creating one then promoting it is a
// two-step dance the LLM flow also avoids). When the row IS already the
// default, render a badge instead of the button so the action isn't
// visible while the result is already true. Mirrors LLMConfigEditForm
// .vue:29-31 / 226-244.
const canPromoteDefault = computed(() =>
  props.scope === 'global'
  && isAdmin.value
  && isEdit.value
  && !(props.config?.is_default ?? false),
)
const isAlreadyDefault = computed(() => props.config?.is_default === true)

// "Set as global default" on create. Only available to admins creating
// a global-scope config — the parent page already picked the scope, so
// there's no need for a "Make this a global configuration" parent
// checkbox the way the LLM create form has. Mirrors
// `LLMConfigCreateForm.vue:181-194`.
const canSetAsGlobalDefault = computed(() =>
  props.scope === 'global'
  && isAdmin.value
  && !isEdit.value,
)
const formAsGlobalDefault = ref(false)

async function promoteToDefault(): Promise<void> {
  if (!props.config || !isAdmin.value) return
  internalSaving.value = true
  try {
    const updated = await store.setDefault(props.config.id)
    applyServerResult(updated)
  } catch (e) {
    errorMessage.value = e instanceof ApiError ? e.message : 'Failed to set as default.'
  } finally {
    internalSaving.value = false
  }
}

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

// PHP `#[ToolSetting(options: [...])]` serialises a `key => label` array
// to a JSON object — so `field.options` reaches the SPA as either an
// array of `{value, label}` (the existing test shape) OR a plain object
// keyed by value. Both shapes need to drive the same `<select>` /
// checkbox list, so normalise to `Array<{value, label}>` here.
interface SelectOption {
  value: string
  label: string
}

function normalizeSelectOptions(options: SpeechProviderConfigSettingsSchema['options']): SelectOption[] {
  if (options === null || options === undefined) return []
  if (Array.isArray(options)) return options
  return Object.entries(options).map(([value, label]) => ({ value, label }))
}

// Multi-select values travel through the form layer as JSON-encoded
// strings (the settings map is `Record<string, string>`). Parse back to
// an array for the checkbox list — fall back to `[]` on any decode
// failure so a malformed stored value doesn't blow up the renderer.
function parseMultiSelect(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw === '') return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    // stored value isn't valid JSON — fall through to []
  }
  return []
}

function toggleMultiSelectValue(fieldKey: string, value: string, checked: boolean): void {
  const current = parseMultiSelect(form[fieldKey] ?? '')
  const next = checked
    ? [...new Set([...current, value])]
    : current.filter(v => v !== value)
  // JSON.stringify keeps the form layer's `Record<string, string>` shape.
  form[fieldKey] = JSON.stringify(next)
}

function isMultiSelectChecked(fieldKey: string, value: string): boolean {
  return parseMultiSelect(form[fieldKey] ?? '').includes(value)
}

// Cache the normalised option list per field so the renderer doesn't
// re-walk the (potentially large) options object on every reactivity
// tick. The key is the schema entry — safe to memo by reference.
const optionsByFieldKey = computed<Map<string, SelectOption[]>>(() => {
  const map = new Map<string, SelectOption[]>()
  for (const field of props.provider.settings_schema) {
    map.set(field.key, normalizeSelectOptions(field.options))
  }
  return map
})

function fieldOptions(key: string): SelectOption[] {
  return optionsByFieldKey.value.get(key) ?? []
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
  // See buildSettingsToSend() below for the matching submission path.
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
    let saved = await persistSettings(settingsToSend)
    // Promote to global default when the operator asked for it on the
    // create flow. The save already succeeded — surface a non-fatal
    // warning if the promote call fails so the config isn't lost.
    if (
      formAsGlobalDefault.value
      && props.scope === 'global'
      && isAdmin.value
      && !isEdit.value
    ) {
      try {
        saved = await store.setDefault(saved.id)
      } catch (e) {
        errorMessage.value = e instanceof ApiError ? e.message : 'Saved, but failed to set as default.'
      }
    }
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
        provider_name: props.provider.display_name,
        provider_display_name: props.provider.display_name,
        scope: 'agent',
        display_name: settingsToSend.display_name ?? props.provider.display_name,
        is_default: false,
        is_global: false,
        principal_id: null,
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
    // Same display_name forwarding as the create path below — when the
    // operator edits the display_name field in the form and saves, the
    // row's `display_name` column must move with it, not just the
    // settings blob. The Rename action handles label-only changes via
    // a separate modal; this keeps the in-form edit path consistent.
    const displayName = settingsToSend.display_name
    return await store.update(props.config.id, {
      ...(typeof displayName === 'string' && displayName !== ''
        ? { display_name: displayName }
        : {}),
      settings: settingsToSend,
    })
  }
  // `display_name` lives in the settings schema (it's a #[ToolSetting] on
  // the provider class) but the new backend reads it from the top-level
  // body field — `SpeechProviderConfigPersistence::validateNewConfigurationInputs`
  // falls back to the FQCN when the field is missing. Pull it out of the
  // settings map so the operator's label sticks for every scope (user,
  // group, global). Agent scope writes through useToolSettings, not this
  // path.
  const displayName = settingsToSend.display_name
  return await store.upsert({
    provider_class: props.provider.class,
    scope: props.scope,
    settings: settingsToSend,
    ...(typeof displayName === 'string' && displayName !== ''
      ? { display_name: displayName }
      : {}),
    ...(props.scope === 'group' && typeof props.groupId === 'number'
      ? { group_id: props.groupId }
      : {}),
  })
}

// Rename (edit only) — PUT a partial body with just `display_name`. The
// backend's `applyConfigurationUpdates` merges, so this never touches
// settings. Pre-existing rows whose row-level `display_name` defaulted to
// the FQCN (before this fix shipped) get their operator-set label back.
const renameOpen = ref(false)
const renameValue = ref('')
const renaming = ref(false)

function startRename(): void {
  if (!props.config) return
  renameValue.value = props.config.display_name
  renameOpen.value = true
}

async function confirmRename(): Promise<void> {
  if (!props.config) return
  const next = renameValue.value.trim()
  if (next === '' || next === props.config.display_name) {
    renameOpen.value = false
    return
  }
  renaming.value = true
  try {
    const updated = await store.update(props.config.id, { display_name: next })
    applyServerResult(updated)
    renameOpen.value = false
  } catch (e) {
    errorMessage.value = e instanceof ApiError ? e.message : 'Failed to rename.'
  } finally {
    renaming.value = false
  }
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
      v-if="isEdit"
      type="button"
      @click="emit('cancel')"
      class="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      ← All configurations
    </button>
    <div
      v-if="isEdit && config"
      class="flex items-center gap-3"
    >
      <h1 class="text-lg font-semibold truncate">
        {{ config.display_name }}
      </h1>
      <button
        type="button"
        data-testid="rename-button"
        class="inline-flex h-7 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        @click="startRename"
      >
        Rename
      </button>
    </div>
    <h1
      v-else
      class="text-lg font-semibold"
    >
      New {{ provider.display_name }} configuration
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
            v-for="opt in fieldOptions(field.key)"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>

        <!-- multi-select — checkbox group backed by the field's static
             `options` (PHP serialises key=>label pairs as a JSON object;
             normalizeSelectOptions above flattens that to {value,label}).
             Selected values are stored as a JSON-encoded array string so
             the form layer keeps its `Record<string, string>` shape;
             ToolConfigService::normalizeMultiSelectValues decodes the
             JSON back to an array when the provider reads settings. -->
        <div
          v-else-if="field.type === 'multi-select'"
          class="flex flex-col gap-1.5"
          :class="errors[field.key] !== null && errors[field.key] !== undefined ? 'rounded-md border border-destructive p-2' : ''"
        >
          <label
            v-for="opt in fieldOptions(field.key)"
            :key="opt.value"
            class="flex items-center gap-2 text-sm cursor-pointer"
          >
            <input
              type="checkbox"
              :value="opt.value"
              :checked="isMultiSelectChecked(field.key, opt.value)"
              :disabled="saving"
              class="rounded border-border text-primary focus:ring-primary disabled:opacity-50"
              @change="toggleMultiSelectValue(field.key, opt.value, ($event.target as HTMLInputElement).checked)"
            >
            {{ opt.label }}
          </label>
        </div>

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

    <!-- "Set as global default" on create — admin only, global scope,
         and only available before a row exists (the edit form already
         has its own button below). Mirrors
         `LLMConfigCreateForm.vue:181-194`. The parent page picks the
         scope, so there's no need for a "Make this a global
         configuration" parent checkbox the way the LLM create form
         has. -->
    <label
      v-if="canSetAsGlobalDefault"
      class="flex items-center gap-2 cursor-pointer mt-4"
    >
      <input
        id="set-as-global-default"
        v-model="formAsGlobalDefault"
        type="checkbox"
        data-testid="set-as-default-checkbox"
        class="rounded border-border text-primary focus:ring-primary"
      >
      <span class="text-sm font-medium">Set as global default</span>
    </label>

    <div class="mt-6 flex items-center justify-between gap-4">
      <p
        v-if="errorMessage"
        role="alert"
        class="text-xs text-destructive"
      >
        {{ errorMessage }}
      </p>
      <span v-else />
      <div class="flex items-center gap-2">
        <button
          v-if="canPromoteDefault"
          type="button"
          data-testid="set-default-button"
          :disabled="saving"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 px-4 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
          @click="promoteToDefault"
        >
          Set as Global Default
        </button>
        <span
          v-if="isAlreadyDefault"
          class="inline-flex h-9 items-center rounded-full bg-primary/10 px-3 text-xs font-medium text-primary"
          data-testid="default-badge"
        >
          Global default
        </span>
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

  <Modal
    v-if="config"
    v-model="renameOpen"
    title="Rename Configuration"
    size="sm"
    :backdrop-closable="!renaming"
  >
    <label class="flex flex-col gap-1.5">
      <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Display name
      </span>
      <input
        v-model="renameValue"
        type="text"
        autocomplete="off"
        data-testid="rename-input"
        class="h-9 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        @keydown.enter.prevent="confirmRename"
      >
    </label>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          @click="renameOpen = false"
          :disabled="renaming"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="rename-confirm"
          @click="confirmRename"
          :disabled="renaming || renameValue.trim() === '' || renameValue.trim() === config.display_name"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <Icon
            v-if="renaming"
            name="loader-2"
            class="h-3.5 w-3.5 mr-1 animate-spin"
          />
          {{ renaming ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </template>
  </Modal>
</template>
