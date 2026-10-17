<script setup lang="ts">
/**
 * RuntimeSettingsLayout — the frame around the five settings pages, and the
 * only place the payload is fetched.
 *
 * One fetch for all five pages rather than one per page: they are five views of
 * a single registry, and a per-page fetch would mean the table on one page
 * disagreeing with the table on another after a save.
 */
import { computed, onMounted } from 'vue'
import { useAdminAuth } from '@/composables/useAdminAuth'
import { useToast } from '@/composables/useToast'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import { RUNTIME_PAGES } from '@/lib/runtimeSettings'
import AdminForbidden from '@/components/admin/AdminForbidden.vue'

const { isAdmin } = useAdminAuth()
const toast = useToast()
const store = useGlobalSettingsStore()

const tabs = [
  ...RUNTIME_PAGES.map((page) => ({
    name: `settings-admin-runtime-${page.key}`,
    label: page.label,
  })),
  { name: 'settings-admin-runtime-system', label: 'System' },
]

const editableCount = computed(() =>
  store.sections.reduce(
    (count, section) => count + section.settings.filter((s) => !s.readonly).length,
    0,
  ),
)

const fileOnlyCount = computed(() =>
  store.sections.reduce(
    (count, section) => count + section.settings.filter((s) => s.readonly).length,
    0,
  ),
)

onMounted(async () => {
  if (!isAdmin.value) return
  if (store.sections.length > 0) return
  try {
    await store.fetchSettings()
  } catch {
    toast.error('Failed to load runtime settings.')
  }
})
</script>

<template>
  <AdminForbidden v-if="!isAdmin" />

  <div v-else>
    <div class="mb-6">
      <h1 class="text-lg font-semibold">
        Runtime settings
      </h1>
      <p class="text-sm text-muted-foreground mt-0.5">
        What Spora is running right now. A value saved here lives in the database
        and takes precedence over the files on disk.
      </p>
      <p
        v-if="store.sections.length > 0"
        class="text-xs text-muted-foreground mt-1"
      >
        {{ editableCount }} editable here, {{ fileOnlyCount }} read from your files.
      </p>
    </div>

    <nav class="mb-6 border-b border-border">
      <ul class="flex flex-wrap gap-1 -mb-px">
        <li
          v-for="tab in tabs"
          :key="tab.name"
        >
          <RouterLink
            :to="{ name: tab.name }"
            class="inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            active-class="!border-primary !text-foreground font-medium"
          >
            {{ tab.label }}
          </RouterLink>
        </li>
      </ul>
    </nav>

    <RouterView />
  </div>
</template>