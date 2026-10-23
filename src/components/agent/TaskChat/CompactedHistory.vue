<script setup lang="ts">
/**
 * CompactedHistory — the collapsed block that stands in for the turns a
 * compaction replaced.
 *
 * A compaction keeps the turns it replaces in the history: the model gets a
 * summary in their place, the operator keeps the turns. This block is where
 * the two meet — collapsed it says how much was compacted, expanded it shows
 * what the model was told and the turns it was told instead of.
 *
 * It sits above the message list rather than inside it: the compacted
 * region is always a prefix of the transcript, so it would otherwise split
 * the turn structure.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@spora-ai/components/icons'
import { renderMarkdown } from '@/composables/useMarkdown'
import type { CompactedHistory } from '@/composables/useTaskChat'
import type { HistoryEntry } from '@/types/task'

const props = defineProps<{
  compacted: CompactedHistory
}>()

const { t } = useI18n()

const expanded = ref(false)

const summaryHtml = computed(() => renderMarkdown(props.compacted.summary))

/**
 * The compacted turns, one line each.
 *
 * Tool results are left out: there are usually more of them than turns, and
 * the summary is what the model actually reads. The point of the block is to
 * show what was folded away, not to re-render the chat.
 */
const turns = computed(() =>
  props.compacted.rows
    .filter((row) => row.role !== 'tool')
    .map((row) => ({ row, text: turnText(row) }))
    .filter((turn) => turn.text !== ''),
)

const headerLabel = computed<string>(() => {
  if (turns.value.length === 0) {
    return t('Conversation compacted')
  }
  return turns.value.length === 1
    ? t('{count} turn compacted', { count: turns.value.length })
    : t('{count} turns compacted', { count: turns.value.length })
})

function turnText(row: HistoryEntry): string {
  if (row.content && row.content.trim() !== '') return row.content
  const text = (row.content_blocks ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
  return text.trim()
}
</script>

<template>
  <div
    class="flex justify-start"
    data-testid="compacted-history"
  >
    <div class="w-full max-w-[95%] lg:max-w-[85%] min-w-0">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
        :aria-expanded="expanded"
        data-testid="compacted-history-toggle"
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
        <span class="font-medium tracking-wide uppercase">
          {{ headerLabel }}
        </span>
      </button>

      <div
        v-if="expanded"
        class="mt-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm"
        data-testid="compacted-history-details"
      >
        <p class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ t('What the model was told') }}
        </p>
        <div
          class="chat-bubble-content text-foreground"
          v-html="summaryHtml"
        />

        <p class="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ t('The compacted turns') }}
        </p>
        <ul class="space-y-1.5">
          <li
            v-for="turn in turns"
            :key="turn.row.sequence"
            class="text-xs text-muted-foreground"
            :data-testid="`compacted-turn-${turn.row.sequence}`"
          >
            <span class="font-medium uppercase">{{ turn.row.role }}</span>
            <span class="whitespace-pre-wrap break-words">{{ turn.text }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
