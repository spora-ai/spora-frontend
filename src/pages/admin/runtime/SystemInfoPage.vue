<script setup lang="ts">
/**
 * SystemInfoPage — the settings that live in the files, shown rather than shown
 * as a form.
 *
 * These were rendered as disabled inputs, which is the one presentation that is
 * wrong for them in every way: it looks editable, it is not, and a row of eight
 * greyed boxes reads as configuration that exists and refuses to be touched. So
 * there are no controls here at all — a definition list, because the question
 * this page answers is "what is Spora actually running against", and a form
 * implies the answer is changeable.
 *
 * Secrets are shown as a state and never as a value. The wire cannot tell us
 * more: `value` is the literal `'***'` whether the row holds a credential or
 * there is no row, so the mask says nothing. `source` can — it is `default`
 * only when no layer supplied anything — and `undecryptable` covers the third
 * case, a row that exists but no longer opens with the current key.
 */
import { computed } from 'vue'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import { displayValue, secretState, systemSections } from '@/lib/runtimeSettings'
import type { GlobalSetting } from '@/types/globalSettings'
import AdminSection from '@/components/admin/AdminSection.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'

const store = useGlobalSettingsStore()

const sections = computed(() => systemSections(store.sections))

const total = computed(() =>
  sections.value.reduce((count, section) => count + section.settings.length, 0),
)

/** The value as it should be read, with the empty case named rather than blank. */
function rendered(setting: GlobalSetting): string {
  if (setting.secret) return secretState(setting)
  const value = displayValue(setting)
  return value === '' ? 'Not set' : value
}
</script>

<template>
  <AdminSection
    title="System"
    :description="`${total} settings Spora reads from your files before the database is available. They are shown here for reference; change them in your \`.env\` or \`config.php\`.`"
    :loading="store.loading"
  >
    <AlertBanner
      v-if="store.error"
      type="error"
      :message="store.error"
      class="mb-4"
    />

    <p
      v-if="!store.loading && sections.length === 0"
      class="text-sm text-muted-foreground"
    >
      No file-only settings are registered.
    </p>

    <div
      v-else
      class="flex flex-col gap-8"
    >
      <section
        v-for="section in sections"
        :key="section.key"
      >
        <h2 class="text-sm font-semibold mb-3">
          {{ section.label }}
        </h2>

        <dl class="flex flex-col divide-y divide-border">
          <div
            v-for="setting in section.settings"
            :key="setting.key"
            class="grid grid-cols-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] gap-x-4 gap-y-0.5 py-2.5"
          >
            <dt class="text-sm text-muted-foreground">
              {{ setting.label }}
              <span class="block font-mono text-[11px] text-muted-foreground/70">
                {{ setting.key }}
              </span>
            </dt>
            <dd
              class="text-sm font-mono break-words"
              :class="rendered(setting) === 'Not set' ? 'text-muted-foreground italic' : ''"
            >
              {{ rendered(setting) }}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  </AdminSection>
</template>