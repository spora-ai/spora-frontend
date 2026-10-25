<script setup lang="ts">
/**
 * CompactionMarker — the mark a compaction leaves in the transcript.
 *
 * A compaction replaces the older turns with a summary for the model; the
 * turns themselves stay in the transcript. The marker says how much was
 * compacted and, expanded, what the model was given in their place.
 *
 * It stands where the compaction happened: the summary row was appended to
 * the history at that moment, so the marker sits at that point in the
 * conversation and the transcript reads in the order it went.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@spora-ai/components/icons'
import { renderMarkdown } from '@/composables/useMarkdown'

const props = defineProps<{
  /** How many turns the summary stands in for. */
  count: number
  /** What the model was given in their place. */
  summary: string
}>()

const { t } = useI18n()

const expanded = ref(false)

const headerLabel = computed<string>(() => {
  const count = props.count
  if (count === 0) {
    return t('Conversation compacted')
  }
  return count === 1
    ? t('{count} message compacted', { count })
    : t('{count} messages compacted', { count })
})

const summaryHtml = computed(() => renderMarkdown(props.summary))
</script>

<template>
  <div
    class="min-w-0 max-w-full"
    data-testid="compaction-marker"
  >
    <button
      type="button"
      class="flex w-full items-center gap-2 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
      :aria-expanded="expanded"
      data-testid="compaction-marker-toggle"
      @click="expanded = !expanded"
    >
      <Icon
        :name="expanded ? 'chevron-down' : 'chevron-right'"
        class="h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
      />
      <Icon
        name="list-checks"
        class="h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
      />
      <span class="whitespace-nowrap font-medium tracking-wide uppercase">
        {{ headerLabel }}
      </span>
    </button>

    <div
      v-if="expanded"
      class="border-t border-border py-3 text-sm"
      data-testid="compaction-marker-details"
    >
      <p class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {{ t('What the model was told') }}
      </p>
      <!--
        `break-words` so a long unbroken string in the summary wraps
        instead of running out of the transcript.
      -->
      <div
        class="chat-bubble-content text-foreground break-words"
        data-testid="compaction-marker-summary"
        v-html="summaryHtml"
      />
    </div>
  </div>
</template>
