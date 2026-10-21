<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolSchema } from '@/composables/useToolSettings'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  tool: Pick<ToolSchema, 'tool_name' | 'display_name'>
}>()

/**
 * The name the model sees. `display_name` is operator copy and gets
 * translated, so it is the wrong string to say when asking an LLM for a
 * tool — the technical name is the only one that reaches the model.
 *
 * Hidden when the tool has no display name or when it already equals the
 * technical name: the headline shows it then, and a second copy next to
 * itself is noise.
 */
const technicalName = computed(() =>
  props.tool.display_name && props.tool.display_name !== props.tool.tool_name
    ? props.tool.tool_name
    : null,
)

/**
 * The bubble is a child of the badge rather than a native `title`: the
 * browser's own tooltip waits about a second, and this one has to answer
 * the question the badge raises — "which name do I tell the LLM?".
 *
 * It opens on the pointer alone. The badge cannot be a focusable trigger:
 * two of the four surfaces that render it put it inside a row `<button>`,
 * and an interactive element inside a button is invalid HTML — the parser
 * closes the outer button and the row falls apart. The technical name
 * itself is plain text, so a screen reader reads it either way; only the
 * explanation is pointer-only.
 */
const tooltipOpen = ref(false)
</script>

<template>
  <span
    v-if="technicalName"
    class="relative inline-flex"
    @mouseenter="tooltipOpen = true"
    @mouseleave="tooltipOpen = false"
  >
    <span
      class="font-mono text-xs text-muted-foreground select-text"
      data-testid="tool-technical-name"
    >{{ technicalName }}</span>
    <span
      role="tooltip"
      class="pointer-events-none absolute left-1/2 bottom-full z-50 mb-1.5 w-max max-w-[15rem] -translate-x-1/2 rounded-md border border-border bg-card px-2 py-1 text-xs leading-snug text-foreground shadow-md"
      :class="tooltipOpen ? 'block' : 'hidden'"
    >{{ t('This is the tool invocation name the LLM sees') }}</span>
  </span>
</template>
