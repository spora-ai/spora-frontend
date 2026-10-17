<script setup lang="ts">
/**
 * SettingsTable — every setting on a page, as the value in force right now.
 *
 * This replaced a form. The reason is that a form cannot answer the two
 * questions an operator actually has: where does this value come from, and what
 * happens if I save. A table answers both in the same row — the value in the
 * second column, the layer that supplied it in the third — so there is nothing
 * to interpret and nothing that a save could silently change.
 *
 * The Source column is never empty. A setting still sitting at its built-in
 * default reads `Default`, which is a fact; showing nothing there made it
 * indistinguishable from a row nobody had looked at.
 *
 * A value inherited from a file is muted and a stored one is not. They are both
 * in force, so they belong in the same column, but they are not the same kind
 * of thing — and rendering them alike is what made an `.env` entry look like
 * something Spora had been configured with.
 *
 * Only database-sourced rows offer *Clear*. That is the one action that gives
 * a value back — deleting the stored row lets `.env`, `config.php` or the
 * default take over again — so offering it anywhere else would be a button that
 * does nothing.
 *
 * *Edit* sits once per section, in the heading, because the thing it opens is
 * the whole section. Repeating it on every row gave eight identical links for
 * the eight settings in Mail, and a row-level action that does not act on that
 * row is a lie about scope.
 */
import { computed } from 'vue'
import { effectiveValue, SOURCE_COLUMN } from '@/lib/runtimeSettings'
import type { GlobalSetting, GlobalSettingSection } from '@/types/globalSettings'

const props = defineProps<{
  sections: GlobalSettingSection[]
  /** False on the System page, where no row can be edited here. */
  editable: boolean
}>()

const emit = defineEmits<{
  edit: [sectionKey: string]
  clear: [setting: GlobalSetting]
}>()

const rows = computed(() => props.sections.flatMap((section) => section.settings))

function isUnset(setting: GlobalSetting): boolean {
  return effectiveValue(setting) === 'Not set'
}

/**
 * A value this system stores reads at full strength; a value borrowed from a
 * file is muted.
 *
 * Both are in force right now, which is why they share a column — but they are
 * not the same kind of thing, and rendering them identically is what made an
 * `.env` entry look like a setting Spora had been configured with. Muted says
 * "your file is supplying this", and the difference matters: a stored value
 * survives an edit to the file, an inherited one changes under you.
 */
function valueClass(setting: GlobalSetting): string[] {
  if (setting.source === 'database') return []
  return isUnset(setting) ? ['text-muted-foreground', 'italic'] : ['text-muted-foreground']
}

function canClear(setting: GlobalSetting): boolean {
  return props.editable && setting.source === 'database'
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <section
      v-for="section in sections"
      :key="section.key"
    >
      <div class="flex items-baseline justify-between gap-3 mb-3">
        <h2 class="text-sm font-semibold">
          {{ section.label }}
        </h2>
        <button
          v-if="editable"
          type="button"
          class="inline-flex h-7 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          @click="emit('edit', section.key)"
        >
          Edit {{ section.label }}
        </button>
      </div>

      <div class="rounded-lg border border-border overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40 text-left">
              <th class="px-3 py-2 font-medium text-muted-foreground">
                Setting
              </th>
              <th class="px-3 py-2 font-medium text-muted-foreground">
                Effective value
              </th>
              <th class="px-3 py-2 font-medium text-muted-foreground">
                Source
              </th>
              <th class="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="setting in section.settings"
              :key="setting.key"
              class="border-b border-border last:border-b-0 align-top"
            >
              <td class="px-3 py-2.5">
                <span class="block">{{ setting.label }}</span>
                <span class="block font-mono text-[11px] text-muted-foreground/70">
                  {{ setting.key }}
                </span>
                <span
                  v-if="setting.description"
                  class="block text-xs text-muted-foreground mt-0.5 max-w-prose"
                >{{ setting.description }}</span>
              </td>
              <td
                class="px-3 py-2.5 font-mono break-words max-w-md"
                :class="valueClass(setting)"
              >
                {{ effectiveValue(setting) }}
              </td>
              <td class="px-3 py-2.5 whitespace-nowrap">
                <span class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {{ SOURCE_COLUMN[setting.source] }}
                </span>
              </td>
              <td class="px-3 py-2.5 whitespace-nowrap text-right">
                <button
                  v-if="canClear(setting)"
                  type="button"
                  class="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  @click="emit('clear', setting)"
                >
                  Clear
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p
      v-if="rows.length === 0"
      class="text-sm text-muted-foreground"
    >
      No settings here.
    </p>
  </div>
</template>