<script setup lang="ts">
/**
 * EffortSelect — the reasoning-effort picker.
 *
 * Two variants:
 *   - the labelled pill, for the initial composer: the word "Effort" in
 *     front of a select carrying the levels.
 *   - the compact variant, for the follow-up row, whose four neighbours are
 *     all `h-7` icon buttons: an icon-only trigger with the platform's own
 *     select on top of it, so the dropdown is the one the browser renders.
 *
 * The pill ships its own chevron: `appearance-none` removes the native
 * arrow and `src/style.css` has no `select` rule to put one back.
 */
import { computed } from 'vue'
import { Icon } from '@spora-ai/components/icons'
import { useI18n } from 'vue-i18n'
import type { EffortOption, EffortSelection } from '@/types/effort'

const props = withDefaults(defineProps<{
  /** The levels the agent's driver offers. */
  levels: EffortOption[]
  /** The chosen level, or `''` for the model default. */
  modelValue?: EffortSelection
  /** Icon-only trigger for a row of icon buttons. */
  compact?: boolean
  disabled?: boolean
}>(), {
  modelValue: undefined,
  compact: false,
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: EffortSelection]
}>()

const { t } = useI18n()

/**
 * The "model default" choice. The backend reads an empty `effort` as
 * "the model default", which is not the same as sending no `effort` at all.
 */
const MODEL_DEFAULT = ''

interface Choice {
  value: EffortSelection
  label: string
}

const choices = computed<Choice[]>(() => [
  { value: MODEL_DEFAULT, label: t('Model default') },
  ...props.levels.map(level => ({ value: level.value, label: level.label })),
])

const currentLabel = computed(() =>
  choices.value.find(choice => choice.value === props.modelValue)?.label ?? t('Model default'),
)

function onChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  emit('update:modelValue', target.value as EffortSelection)
}
</script>

<template>
  <div
    v-if="compact"
    class="relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    :class="disabled ? 'opacity-50' : ''"
    :title="currentLabel"
  >
    <Icon
      name="brain"
      class="h-3.5 w-3.5"
      aria-hidden="true"
    />
    <select
      :aria-label="t('Reasoning effort')"
      :value="modelValue"
      :disabled="disabled"
      class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      data-testid="effort-select"
      @change="onChange"
    >
      <option
        v-for="choice in choices"
        :key="choice.value"
        :value="choice.value"
      >
        {{ choice.label }}
      </option>
    </select>
  </div>

  <div
    v-else
    class="inline-flex items-center gap-1.5"
  >
    <span class="text-[11px] font-medium text-muted-foreground">{{ t('Effort') }}</span>
    <div class="relative inline-flex items-center">
      <select
        :aria-label="t('Reasoning effort')"
        :value="modelValue"
        :disabled="disabled"
        class="h-7 appearance-none rounded-md border border-border bg-background pl-2 pr-6 text-[11px] font-medium text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
        data-testid="effort-select"
        @change="onChange"
      >
        <option
          v-for="choice in choices"
          :key="choice.value"
          :value="choice.value"
        >
          {{ choice.label }}
        </option>
      </select>
      <Icon
        name="chevron-down"
        class="pointer-events-none absolute right-1.5 h-3 w-3 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  </div>
</template>
