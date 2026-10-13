<script setup lang="ts">
/**
 * GlobalSettingsPage — operator-facing editor for Spora's runtime
 * configuration (`GET`/`PATCH`/`DELETE /api/v1/admin/settings`).
 *
 * The registry on the server decides every field: which keys exist, their
 * type, default, precedence layer and whether they are boot-time. The page
 * only drafts values and diffs them against what it loaded — the diff is
 * what decides what goes into the PATCH, because a masked secret the operator
 * never touched must not be sent back as the literal `'***'`.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useAdminAuth } from '@/composables/useAdminAuth'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useToast } from '@/composables/useToast'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminForbidden from '@/components/admin/AdminForbidden.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import ToolSettingField from '@/components/settings/ToolSettingField.vue'
import type { ToolSettingSchema } from '@/composables/useToolSettings'
import type {
  GlobalSetting,
  GlobalSettingOption,
  GlobalSettingSection,
  GlobalSettingUpdate,
  GlobalSettingValue,
} from '@/types/globalSettings'

/** What a field carries in the draft: a toggle is a boolean, everything else a string. */
type DraftValue = string | boolean
type Draft = Record<string, Record<string, DraftValue>>

const { isAdmin } = useAdminAuth()
const { confirm } = useConfirmDialog()
const toast = useToast()
const store = useGlobalSettingsStore()

const draft = ref<Draft>({})
const baseline = ref<Draft>({})

/** Where the value currently lives, in the wording an operator recognises. */
const SOURCE_LABEL: Record<GlobalSetting['source'], string> = {
  default: 'the built-in default',
  'config.php': 'your `config.php`',
  env: 'your `.env`',
  database: 'the database',
}

function toDraft(sections: GlobalSettingSection[]): Draft {
  const out: Draft = {}
  for (const section of sections) {
    out[section.key] = {}
    for (const setting of section.settings) {
      out[section.key][setting.key] = draftValue(setting)
    }
  }
  return out
}

function draftValue(setting: GlobalSetting): DraftValue {
  if (setting.type === 'toggle') return setting.value === true || setting.value === 'true'
  // One item per line, matching the textarea it seeds and the tokeniser on
  // the other side. JSON.stringify() also round-trips, but it ships the
  // brackets and quotes as part of every entry, and the server splits on
  // whitespace — so a list the operator merely edited came back stored as
  // `"png"`, which matches no real MIME subtype.
  if (Array.isArray(setting.value)) return setting.value.join('\n')
  return setting.value === null || setting.value === undefined ? '' : String(setting.value)
}

/** The value that crosses the wire for one setting, or `undefined` to omit it. */
function toWireValue(setting: GlobalSetting, value: DraftValue): GlobalSettingValue | undefined {
  if (setting.readonly) return undefined
  if (setting.type === 'toggle') return value === true || value === 'true'
  if (setting.type === 'multi-select') {
    if (typeof value !== 'string' || value.trim() === '') return []
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as string[]) : [String(value)]
    } catch {
      return [value]
    }
  }
  // `list` and every scalar type travel as the text the operator typed; the
  // server owns the splitting rules and the page does not re-shape them.
  return String(value)
}

function isLabelled(option: GlobalSettingOption | string): option is GlobalSettingOption {
  return typeof option === 'object' && option !== null
}

function toFieldSchema(setting: GlobalSetting): ToolSettingSchema {
  const options: Array<GlobalSettingOption | string> = setting.options ?? []
  // The registry ships `{value,label}[]` for `select`; the shared field reads
  // a `value → label` map. `multi-select` ships bare strings, which the field
  // now reads directly.
  const labelled = options.filter(isLabelled)
  const fieldOptions: Record<string, string> | string[] = labelled.length > 0
    ? Object.fromEntries(labelled.map((o) => [o.value, o.label]))
    : options.filter((o): o is string => typeof o === 'string')

  return {
    key: setting.key,
    label: setting.label,
    type: setting.type === 'list' ? 'textarea' : setting.type,
    description: setting.description,
    default: setting.default,
    required: false,
    options: Object.keys(fieldOptions).length > 0 ? fieldOptions : null,
    expose_to_llm: false,
  }
}

const updates = computed<GlobalSettingUpdate[]>(() => {
  const out: GlobalSettingUpdate[] = []
  for (const section of store.sections) {
    for (const setting of section.settings) {
      const current = draft.value[section.key]?.[setting.key]
      if (current === undefined || current === baseline.value[section.key]?.[setting.key]) continue
      const value = toWireValue(setting, current)
      if (value === undefined) continue
      out.push({ group: setting.group, key: setting.key, value })
    }
  }
  return out
})

const isDirty = computed(() => updates.value.length > 0)

function setValue(section: GlobalSettingSection, setting: GlobalSetting, value: unknown): void {
  if (!draft.value[section.key]) draft.value[section.key] = {}
  draft.value[section.key][setting.key] = typeof value === 'boolean' ? value : String(value ?? '')
}

function seed(payload: GlobalSettingSection[]): void {
  const next = toDraft(payload)
  draft.value = next
  baseline.value = JSON.parse(JSON.stringify(next)) as Draft
}

watch(
  () => store.sections,
  (payload) => { if (payload.length > 0) seed(payload) },
  { immediate: true },
)

onMounted(async () => {
  if (!isAdmin.value) return
  try {
    await store.fetchSettings()
  } catch {
    toast.error('Failed to load global settings.')
  }
})

async function save(): Promise<void> {
  const pending = updates.value
  if (pending.length === 0) return
  try {
    await store.save(pending)
    // Re-baseline against what the store just applied, so the next Save does
    // not re-send the same payload.
    seed(store.sections)
    toast.success('Settings saved.')
  } catch {
    toast.error(store.error ?? 'Failed to save global settings.')
  }
}

async function resetToDefault(setting: GlobalSetting): Promise<void> {
  const confirmed = await confirm(
    `Reset ${setting.label} to its default? Anything set in your .env or config.php takes effect again.`,
    'Reset setting?',
    'Reset',
  )
  if (!confirmed) return
  try {
    await store.resetSetting(setting.group, setting.key)
    toast.success(`${setting.label} reset to its default.`)
  } catch {
    toast.error(store.error ?? 'Failed to reset the setting.')
  }
}
</script>

<template>
  <AdminForbidden v-if="!isAdmin" />

  <AdminSection
    v-else
    title="Global Settings"
    description="Spora's runtime configuration. Saved values live in the database and take precedence over the files on disk."
    :loading="store.loading"
  >
    <AlertBanner
      v-if="store.error"
      type="error"
      :message="store.error"
      class="mb-4"
    />

    <AlertBanner
      v-if="store.undecryptable.length > 0"
      type="warning"
      class="mb-4"
      :message="`These settings could not be decrypted and are running on their defaults: ${store.undecryptable.join(', ')}. Set them again here to store a readable value.`"
    />

    <p
      v-if="!store.loading && store.sections.length === 0"
      class="text-sm text-muted-foreground"
    >
      No settings are registered.
    </p>

    <form
      v-else
      class="flex flex-col gap-8"
      @submit.prevent="save"
    >
      <section
        v-for="section in store.sections"
        :key="section.key"
      >
        <h2 class="text-sm font-semibold mb-3">
          {{ section.label }}
        </h2>

        <div class="flex flex-col gap-5">
          <div
            v-for="setting in section.settings"
            :key="setting.key"
          >
            <ToolSettingField
              :model-value="draft[section.key]?.[setting.key] ?? ''"
              :field="toFieldSchema(setting)"
              :disabled="setting.readonly || store.saving"
              @update:model-value="setValue(section, setting, $event)"
            />

            <p
              v-if="setting.readonly"
              class="text-xs text-muted-foreground mt-1"
            >
              Read from <code class="font-mono">config.php</code> or your
              <code class="font-mono">.env</code> before the database is available, so it cannot be changed here.
            </p>

            <p
              v-if="setting.source !== 'database' && !setting.readonly"
              class="text-xs text-muted-foreground mt-1"
            >
              Currently from <code class="font-mono">{{ setting.key }}</code> in
              {{ SOURCE_LABEL[setting.source] }} — saving here takes precedence.
            </p>

            <p
              v-if="setting.applies_on === 'worker_restart'"
              class="text-xs text-muted-foreground mt-1"
            >
              Takes effect after the workers restart.
            </p>

            <div
              v-if="setting.undecryptable"
              class="mt-1 text-xs text-yellow-700 dark:text-yellow-300"
            >
              The stored value could not be decrypted; this setting is running on its default.
            </div>

            <div
              v-if="setting.source === 'database' && !setting.readonly"
              class="mt-1"
            >
              <button
                type="button"
                class="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                :disabled="store.saving"
                @click="resetToDefault(setting)"
              >
                Reset to default
              </button>
            </div>
          </div>
        </div>
      </section>

      <div class="flex items-center justify-end gap-3">
        <span
          v-if="isDirty"
          class="text-xs text-muted-foreground"
        >
          {{ updates.length }} unsaved change{{ updates.length === 1 ? '' : 's' }}
        </span>
        <button
          type="submit"
          :disabled="!isDirty || store.saving"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {{ store.saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </form>
  </AdminSection>
</template>