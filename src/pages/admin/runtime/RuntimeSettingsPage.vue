<script setup lang="ts">
/**
 * RuntimeSettingsPage — one of the editable runtime-settings pages, rendered
 * from the `pageKey` prop rather than as one component per page.
 *
 * A component per page would be five files that differ by a constant, and every
 * new setting would need a decision about which file it belongs in. Here the
 * sections come from `PAGE_MAP`, so a setting needs a mapping entry and nothing
 * else.
 *
 * Saving is per page. A single save bar across all four pages would mean
 * editing mail, navigating to media and having both go out on one click — the
 * operator did not ask for that, and the second page's contents were not what
 * they were looking at when they pressed the button. The draft is in the store,
 * so switching pages keeps the edits; only the act of saving is local.
 */
import { computed } from 'vue'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useToast } from '@/composables/useToast'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import { RUNTIME_PAGES, sectionsForPage, toFieldSchema } from '@/lib/runtimeSettings'
import type { RuntimePageKey } from '@/lib/runtimeSettings'
import type { GlobalSetting } from '@/types/globalSettings'
import AdminSection from '@/components/admin/AdminSection.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import ToolSettingField from '@/components/settings/ToolSettingField.vue'

const props = defineProps<{ pageKey: RuntimePageKey }>()

const { confirm } = useConfirmDialog()
const toast = useToast()
const store = useGlobalSettingsStore()

const page = computed(() => RUNTIME_PAGES.find((p) => p.key === props.pageKey) ?? RUNTIME_PAGES[0])

const sections = computed(() => sectionsForPage(store.sections, props.pageKey))

const pending = computed(() =>
  sections.value.flatMap((section) => store.pendingBySection[section.key] ?? []),
)

const isDirty = computed(() => pending.value.length > 0)

/**
 * How many values on this page come from a file and would be shadowed by saving
 * here. A setting still sitting at the built-in default is not counted: nothing
 * is being overridden by it, and counting it is what made every field look
 * occupied.
 */
const shadowedCount = computed(() =>
  sections.value.reduce(
    (total, section) =>
      total
      + section.settings.filter(
        (setting) => setting.source === 'env' || setting.source === 'config.php',
      ).length,
    0,
  ),
)

/** Where the value lives, as a chip. Absent means the built-in default. */
function sourceChip(setting: GlobalSetting): string | null {
  if (setting.source === 'env') return '.env'
  if (setting.source === 'config.php') return 'config.php'
  if (setting.source === 'database') return 'stored here'
  return null
}

function isShadowed(setting: GlobalSetting): boolean {
  return setting.source === 'env' || setting.source === 'config.php'
}

async function save(): Promise<void> {
  if (pending.value.length === 0) return
  try {
    await store.save(pending.value)
    // Re-baseline against what the store just applied, so the next Save does
    // not re-send the same payload.
    store.seedDraft(store.sections)
    toast.success('Settings saved.')
  } catch {
    toast.error(store.error ?? 'Failed to save settings.')
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
      :message="`These settings could not be decrypted and are running on their defaults: ${store.undecryptable.join(', ')}. Set them again here to store a readable value.`"
    />

    <p
      v-if="shadowedCount > 0"
      class="text-sm text-muted-foreground mb-5"
    >
      <span class="text-foreground">{{ shadowedCount }}</span>
      value{{ shadowedCount === 1 ? '' : 's' }} on this page {{ shadowedCount === 1 ? 'is' : 'are' }}
      set in a file and {{ shadowedCount === 1 ? 'takes' : 'take' }} precedence over the database
      until you save here.
    </p>

    <p
      v-if="!store.loading && sections.length === 0"
      class="text-sm text-muted-foreground"
    >
      No settings on this page.
    </p>

    <form
      v-else
      class="flex flex-col gap-8"
      @submit.prevent="save"
    >
      <section
        v-for="section in sections"
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
            <div class="flex items-baseline justify-between gap-3 mb-1.5">
              <label
                :for="setting.key"
                class="text-sm font-medium"
              >{{ setting.label }}</label>
              <span
                v-if="sourceChip(setting)"
                class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                :class="isShadowed(setting)
                  ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                  : 'bg-muted text-muted-foreground'"
                :title="isShadowed(setting)
                  ? `Currently from your ${setting.source}. Saving here takes precedence.`
                  : 'Stored in the database.'"
              >{{ sourceChip(setting) }}</span>
            </div>
            <ToolSettingField
              :model-value="store.draft[section.key]?.[setting.key] ?? ''"
              :field="toFieldSchema(setting)"
              :disabled="store.saving"
              hide-label
              @update:model-value="store.setDraftValue(section.key, setting, $event)"
            />

            <p
              v-if="setting.applies_on === 'worker_restart'"
              class="text-xs text-muted-foreground mt-1"
            >
              Takes effect after the workers restart.
            </p>

            <p
              v-if="setting.undecryptable"
              class="mt-1 text-xs text-yellow-700 dark:text-yellow-300"
            >
              The stored value could not be decrypted; this setting is running on its default.
            </p>

            <button
              v-if="setting.source === 'database'"
              type="button"
              class="mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              :disabled="store.saving"
              @click="resetToDefault(setting)"
            >
              Reset to default
            </button>
          </div>
        </div>
      </section>

      <div class="flex items-center justify-end gap-3">
        <span
          v-if="isDirty"
          class="text-xs text-muted-foreground"
        >
          {{ pending.length }} unsaved change{{ pending.length === 1 ? '' : 's' }}
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