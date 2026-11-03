<script setup lang="ts">
/**
 * SettingsPluginsPage — the Plugins tab.
 *
 * One place for everything about plugins: the plugin system's own settings
 * and the settings every installed plugin contributes. The registry puts them
 * in one section, so the page splits that section back into the groups the
 * settings are stored under and hands each group to the same table and the
 * same overlay the admin runtime pages use. A second form here would be a
 * second place for the secret-handling rules to drift.
 *
 * An admin surface: a plugin's settings are install-wide, and some of them
 * are the OAuth client secrets of the whole installation. Reading them is an
 * admin's job, so the tab sits in the Administration group and the page says
 * so itself — the nav entry being hidden is not access control.
 */
import { computed, onMounted, ref } from 'vue'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import { PLUGINS_SECTION, pluginSections } from '@/lib/pluginSettings'
import { useAdminAuth } from '@/composables/useAdminAuth'
import { useToast } from '@/composables/useToast'
import { useSettingClear } from '@/composables/useSettingClear'
import type { GlobalSettingSection } from '@/types/globalSettings'
import AdminForbidden from '@/components/admin/AdminForbidden.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import SettingsTable from '@/components/settings/runtime/SettingsTable.vue'
import SectionFormDialog from '@/components/settings/runtime/SectionFormDialog.vue'
import PluginInstallNotice from '@/components/settings/runtime/PluginInstallNotice.vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const { isAdmin } = useAdminAuth()
const toast = useToast()
const store = useGlobalSettingsStore()
const { clearValue } = useSettingClear()

const section = computed(() => store.sections.find((s) => s.key === PLUGINS_SECTION))
const groups = computed(() => pluginSections(section.value))

// `store.undecryptable` names every key in the registry that could not be
// decrypted, wherever it lives, so the banner is narrowed to the keys this
// tab owns: a plugin credential is unreadable, and the tab that edits it is
// where that is said.
const undecryptable = computed(() => {
  const keys = new Set(section.value?.settings.map((setting) => setting.key) ?? [])
  return store.undecryptable.filter((key) => keys.has(key))
})

const editingGroup = ref<string | null>(null)

const dialogOpen = computed({
  get: () => editingGroup.value !== null,
  set: (open: boolean) => { if (!open) editingGroup.value = null },
})

const dialogSection = computed<GlobalSettingSection | null>(() =>
  editingGroup.value === null
    ? null
    : groups.value.find((group) => group.key === editingGroup.value) ?? null,
)

function openGroup(groupKey: string): void {
  editingGroup.value = groupKey
}

onMounted(async () => {
  // A non-admin is shown the forbidden state and nothing else: the registry
  // would answer 403 anyway, and a request that is bound to fail is a request
  // an admin's browser should not make.
  if (!isAdmin.value) return
  // The store is shared with the admin runtime pages, so a payload that is
  // already there is the same one they are looking at.
  if (store.sections.length > 0) return
  try {
    await store.fetchSettings()
  } catch {
    toast.error(t('Failed to load global settings.'))
  }
})
</script>

<template>
  <AdminForbidden v-if="!isAdmin" />

  <div v-else>
    <div class="mb-6">
      <h1 class="text-lg font-semibold">
        {{ t('Plugins') }}
      </h1>
      <p class="text-sm text-muted-foreground mt-0.5">
        {{ t('Install plugins, and configure the ones you have installed.') }}
      </p>
    </div>

    <AlertBanner
      v-if="store.error"
      type="error"
      :message="store.error"
      class="mb-4"
    />

    <AlertBanner
      v-if="undecryptable.length > 0"
      type="warning"
      class="mb-4"
      :message="`${t('These settings could not be decrypted and are running on their defaults:')} ${undecryptable.join(', ')}. ${t('Set them again to store a readable value.')}`"
    />

    <PluginInstallNotice />

    <div
      v-if="store.loading"
      class="flex items-center justify-center py-8 text-sm text-muted-foreground"
    >
      {{ t('Loading…') }}
    </div>

    <SettingsTable
      v-else
      :sections="groups"
      :editable="true"
      @edit="openGroup"
      @clear="clearValue"
    />

    <SectionFormDialog
      v-model="dialogOpen"
      :section="dialogSection"
    />
  </div>
</template>
