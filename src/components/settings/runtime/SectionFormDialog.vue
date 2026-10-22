<script setup lang="ts">
/**
 * SectionFormDialog — the editor for one registry section, in an overlay.
 *
 * The draft is local to the dialog and lives only as long as it is open, which
 * is the point: a diff that has to survive a re-read silently reports the page
 * as clean when the pending edits are put back on both sides. An overlay has no
 * such case — nothing is pending while it is closed.
 *
 * Save sends only the fields this dialog actually changed. A setting nobody
 * touched keeps whatever layer it had.
 */
import { computed, ref, watch } from 'vue'
import { useToast } from '@/composables/useToast'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import { draftValue, toFieldSchema, toWireValue } from '@/lib/runtimeSettings'
import type { SectionDraft } from '@/lib/runtimeSettings'
import type { GlobalSetting, GlobalSettingSection, GlobalSettingUpdate } from '@/types/globalSettings'
import Modal from '@/components/Modal.vue'
import ToolSettingField from '@/components/settings/ToolSettingField.vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  modelValue: boolean
  section: GlobalSettingSection | null
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const toast = useToast()
const { confirm } = useConfirmDialog()
const store = useGlobalSettingsStore()

const draft = ref<SectionDraft>({})
const baseline = ref<SectionDraft>({})

/**
 * Re-seeded whenever the section changes, not only when the dialog opens: a
 * clear inside the dialog re-reads the registry, and without this the field
 * would keep showing the value that was just deleted.
 */
watch(
  () => [props.modelValue, props.section] as const,
  ([open, section]) => {
    if (!open || !section) return
    const next: SectionDraft = {}
    for (const setting of section.settings) next[setting.key] = draftValue(setting)
    draft.value = { ...next }
    baseline.value = { ...next }
  },
  { immediate: true, deep: true },
)

const settings = computed<GlobalSetting[]>(() => props.section?.settings ?? [])

const pending = computed<GlobalSettingUpdate[]>(() => {
  const out: GlobalSettingUpdate[] = []
  for (const setting of settings.value) {
    const current = draft.value[setting.key]
    if (current === undefined || current === baseline.value[setting.key]) continue
    const value = toWireValue(setting, current)
    if (value === undefined) continue
    out.push({ group: setting.group, key: setting.key, value })
  }
  return out
})

function setValue(setting: GlobalSetting, value: unknown): void {
  draft.value[setting.key] = typeof value === 'boolean' ? value : String(value ?? '')
}

/** Where the value comes from, restated where the decision to overwrite it is made. */
function overriddenNote(setting: GlobalSetting): string | null {
  if (setting.source !== 'env' && setting.source !== 'config.php') return null
  return `${t('Currently from your')} ${setting.source}. ${t('Saving here stores it in the database, where it takes precedence.')}`
}

async function save(): Promise<void> {
  // Captured before the await, not after. `store.save()` re-reads the registry,
  // which re-seeds `draft` and `baseline` from the same server values, so
  // `pending` recomputes to 0 the moment the write lands. Reading it afterwards
  // reported "0 settings saved" on every successful save.
  const changed = pending.value
  if (changed.length === 0) return
  try {
    await store.save(changed)
    toast.success(`${changed.length} ${changed.length === 1 ? t('setting') : t('settings')} ${t('saved.')}`)
    emit('update:modelValue', false)
  } catch {
    toast.error(store.error ?? t('Failed to save settings.'))
  }
}

/**
 * Delete the stored row so the value comes from the files again. The response
 * names the key but not the layer it fell back to, so the registry is re-read
 * rather than guessed at.
 */
async function clearValue(setting: GlobalSetting): Promise<void> {
  const confirmed = await confirm(
    `${t('Clear the stored value for')} ${setting.label}? ${t('It falls back to your .env, your config.php, or the built-in default.')}`,
    t('Clear stored value?'),
    'Clear',
  )
  if (!confirmed) return
  try {
    await store.resetSetting(setting.group, setting.key)
    toast.success(t('{setting} cleared.', { setting: setting.label }))
  } catch {
    toast.error(store.error ?? t('Failed to clear the setting.'))
  }
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="t('Edit {name}', { name: section?.label ?? '' })"
    size="lg"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-5">
      <div
        v-for="setting in settings"
        :key="setting.key"
      >
        <ToolSettingField
          :model-value="draft[setting.key] ?? ''"
          :field="toFieldSchema(setting)"
          :disabled="store.saving"
          @update:model-value="setValue(setting, $event)"
        />

        <p
          v-if="overriddenNote(setting)"
          class="text-xs text-muted-foreground mt-1"
        >
          {{ overriddenNote(setting) }}
        </p>

        <p
          v-if="setting.undecryptable"
          class="mt-1 text-xs text-yellow-700 dark:text-yellow-300"
        >
          {{ t('The stored value could not be decrypted; this setting is running on its default.') }}
        </p>

        <button
          v-if="setting.source === 'database'"
          type="button"
          class="mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          :disabled="store.saving"
          @click="clearValue(setting)"
        >
          {{ t('Clear stored value') }}
        </button>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between gap-3">
        <span class="text-xs text-muted-foreground">
          <template v-if="pending.length > 0">
            {{ pending.length }} {{ t('unsaved change') }}{{ pending.length === 1 ? '' : 's' }}
          </template>
        </span>
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors hover:bg-muted"
            @click="close"
          >
            {{ t('Cancel') }}
          </button>
          <button
            type="button"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            :disabled="pending.length === 0 || store.saving"
            @click="save"
          >
            {{ store.saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
    </template>
  </Modal>
</template>