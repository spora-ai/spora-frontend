<script setup lang="ts">
import { computed } from 'vue'
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
</script>

<template>
  <span
    v-if="technicalName"
    class="font-mono text-xs text-muted-foreground select-text"
    :title="t('The name the LLM knows this tool by')"
  >{{ technicalName }}</span>
</template>
