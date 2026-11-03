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
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import { useSettingClear } from '@/composables/useSettingClear'
import { runtimePages, sectionByKey, sectionsForPage } from '@/lib/runtimeSettings'
import type { RuntimePageKey } from '@/lib/runtimeSettings'
import AdminSection from '@/components/admin/AdminSection.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import SettingsTable from '@/components/settings/runtime/SettingsTable.vue'
import SectionFormDialog from '@/components/settings/runtime/SectionFormDialog.vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{ pageKey: RuntimePageKey }>()

const store = useGlobalSettingsStore()
const { clearValue } = useSettingClear()

const page = computed(() => {
  const pages = runtimePages()
  return pages.find((p) => p.key === props.pageKey) ?? pages[0]
})

const sections = computed(() => sectionsForPage(store.sections, props.pageKey))

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