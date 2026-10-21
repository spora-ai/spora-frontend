<script setup lang="ts">
/**
 * LocaleSelector — the operator's own interface language.
 *
 * The option list is the frontend's own catalogue set rather than the
 * server's: a plugin can register a language the SPA ships no catalogue
 * for, and offering it would render the interface in raw keys.
 *
 * The labels are endonyms ("Deutsch", not "German"): a user looking for
 * their language scans for the name they know it by, whatever language the
 * interface happens to be in.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@spora-ai/components/icons'
import { availableLocales } from '@/i18n'
import { useLocaleStore } from '@/stores/locale'

/** The option value that stands for "follow the instance default". */
const AUTOMATIC = 'automatic'

/**
 * A language's own name. Not a catalogue key: an endonym reads the same
 * in every interface language, and a translation of one would name the
 * language rather than be the language. A locale this map does not name
 * falls back to its code.
 */
const LOCALE_NAMES: Record<string, string | undefined> = {
  en: 'English',
  de: 'Deutsch',
}

const { t } = useI18n()
const localeStore = useLocaleStore()
const selectId = useId()

/**
 * The selected option. A stored preference this build cannot render reads
 * as "automatic": there is no option for it, and the instance default is
 * the closest truth the picker can show.
 */
const selected = computed<string>({
  get: () => {
    const preference = localeStore.preference
    return preference !== null && availableLocales.includes(preference) ? preference : AUTOMATIC
  },
  set: (value: string) => {
    void localeStore.setLocale(value === AUTOMATIC ? null : value)
  },
})

function localeName(code: string): string {
  return LOCALE_NAMES[code] ?? code
}
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-5 space-y-4">
    <div class="flex items-center gap-2">
      <Icon
        name="globe"
        class="h-4 w-4 text-muted-foreground"
      />
      <h2 class="text-sm font-semibold text-foreground">
        {{ t('Language') }}
      </h2>
    </div>
    <p class="text-xs text-muted-foreground">
      {{ t('The interface language. Changes apply immediately.') }}
    </p>
    <div class="flex flex-col gap-1.5">
      <!-- The heading above is the visible label; this one only names the
           control for a screen reader, matching how AccountPage labels its
           own fields. -->
      <label
        class="sr-only"
        :for="selectId"
      >{{ t('Language') }}</label>
      <select
        :id="selectId"
        v-model="selected"
        class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option :value="AUTOMATIC">
          {{ t('Automatic (instance default)') }}
        </option>
        <option
          v-for="code in availableLocales"
          :key="code"
          :value="code"
        >
          {{ localeName(code) }}
        </option>
      </select>
      <p
        v-if="localeStore.saveError !== null"
        role="alert"
        class="text-xs text-destructive"
      >
        {{ t('Could not save the language preference.') }}
      </p>
    </div>
  </section>
</template>
