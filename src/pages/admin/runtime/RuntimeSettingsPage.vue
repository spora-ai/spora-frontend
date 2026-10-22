<script setup lang="ts">
/**
 * RuntimeSettingsPage — one of the four editable areas, as a table.
 *
 * The page is a shell: it decides which sections belong to this area, and hands
 * them to the table. Everything about editing lives in the overlay, because the
 * table is the thing that answers "what is in force" and a form in the same
 * place is what made that question hard to answer in the first place.
 */
import { computed, ref } from 'vue'
import { useToast } from '@/composables/useToast'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import { runtimePages, sectionByKey, sectionsForPage } from '@/lib/runtimeSettings'
import type { RuntimePageKey } from '@/lib/runtimeSettings'
import type { GlobalSetting } from '@/types/globalSettings'
import AdminSection from '@/components/admin/AdminSection.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import SettingsTable from '@/components/settings/runtime/SettingsTable.vue'
import SectionFormDialog from '@/components/settings/runtime/SectionFormDialog.vue'
import PluginInstallNotice from '@/components/settings/runtime/PluginInstallNotice.vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{ pageKey: RuntimePageKey }>()

const toast = useToast()
const { confirm } = useConfirmDialog()
const store = useGlobalSettingsStore()

const page = computed(() => {
  const pages = runtimePages()
  return pages.find((p) => p.key === props.pageKey) ?? pages[0]
})

const sections = computed(() => sectionsForPage(store.sections, props.pageKey))

/**
 * The composer warning belongs to the plugins section, so it only appears on
 * the page that has one. The notice itself gates on the flag.
 */
const hasPlugins = computed(() => sections.value.some((section) => section.key === 'plugins'))

const editingSection = ref<string | null>(null)

const dialogOpen = computed({
  get: () => editingSection.value !== null,
  set: (open: boolean) => { if (!open) editingSection.value = null },
})

const dialogSection = computed(() =>
  editingSection.value === null ? null : sectionByKey(sections.value, editingSection.value) ?? null,
)

function openSection(sectionKey: string): void {
  editingSection.value = sectionKey
}

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
</script>

<template>
  <AdminSection
    :title="page.label"
    :description="page.description"
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
      :message="`${t('These settings could not be decrypted and are running on their defaults:')} ${store.undecryptable.join(', ')}. ${t('Set them again to store a readable value.')}`"
    />

    <PluginInstallNotice v-if="hasPlugins" />

    <SettingsTable
      :sections="sections"
      :editable="true"
      @edit="openSection"
      @clear="clearValue"
    />

    <SectionFormDialog
      v-model="dialogOpen"
      :section="dialogSection"
    />
  </AdminSection>
</template>