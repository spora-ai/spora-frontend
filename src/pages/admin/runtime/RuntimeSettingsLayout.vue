<script setup lang="ts">
/**
 * RuntimeSettingsLayout — the frame around the runtime settings, and the only
 * place the payload is fetched.
 *
 * One fetch for all five pages rather than one per page: they are five views of
 * a single registry, and each fetching its own would mean a `PUT` on the mail
 * page followed by a reload that discards unsaved edits on the media page.
 *
 * The sub-navigation carries a dot for pages with unsaved work, so switching
 * away and back is safe to do — the draft is in the store — and so an operator
 * who forgot about an edit can see it without visiting the page.
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
    dirty: computed(() => store.isPageDirty(page.key)),
  })),
  {
    name: 'settings-admin-runtime-system',
    label: 'System',
    dirty: computed(() => false),
  },
]

const pendingTotal = computed(() => store.pendingCount)

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
        Spora's configuration. Values saved here live in the database and take
        precedence over the files on disk.
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
            class="inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors"
            :class="tab.dirty.value
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'"
            active-class="!border-primary !text-foreground font-medium"
          >
            {{ tab.label }}
            <span
              v-if="tab.dirty.value"
              class="h-1.5 w-1.5 rounded-full bg-primary"
              aria-label="unsaved changes"
            />
          </RouterLink>
        </li>
      </ul>
    </nav>

    <p
      v-if="pendingTotal > 0"
      class="mb-4 text-xs text-muted-foreground"
    >
      {{ pendingTotal }} unsaved change{{ pendingTotal === 1 ? '' : 's' }} across the runtime settings.
      Saving is per page.
    </p>

    <RouterView />
  </div>
</template>