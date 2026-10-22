<script setup lang="ts">
/**
 * SystemInfoPage — the settings that live in the files.
 *
 * Rendered with the same table as the editable pages, with editing switched
 * off, because it answers a question rather than offering an action: what is
 * Spora actually running against. A second table shape for it would mean two
 * places where a value can be rendered, and they would drift.
 */
import { computed } from 'vue'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import { systemSections } from '@/lib/runtimeSettings'
import AdminSection from '@/components/admin/AdminSection.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import SettingsTable from '@/components/settings/runtime/SettingsTable.vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const store = useGlobalSettingsStore()

const sections = computed(() => systemSections(store.sections))

const total = computed(() =>
  sections.value.reduce((count, section) => count + section.settings.length, 0),
)
</script>

<template>
  <AdminSection
    :title="t('System')"
    :description="`${total} ${t('settings Spora reads from your files before the database is available. Change them in your \`.env\` or \`config.php\`.')}`"
    :loading="store.loading"
  >
    <AlertBanner
      v-if="store.error"
      type="error"
      :message="store.error"
      class="mb-4"
    />

    <SettingsTable
      :sections="sections"
      :editable="false"
    />
  </AdminSection>
</template>