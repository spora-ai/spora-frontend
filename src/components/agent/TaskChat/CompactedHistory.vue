<script setup lang="ts">
/**
 * CompactedHistory — the block that stands in for the turns a compaction
 * replaced.
 *
 * A compaction keeps the turns it replaced in the history: the model gets a
 * summary in their place, the operator keeps the turns. This block is where
 * the two meet — collapsed it says how much was compacted, expanded it shows
 * what the model was told and the turns it was told instead of.
 *
 * It sits above the composer, as a sibling of the message list: the
 * transcript scrolls past it, and the operator asked for the compaction and
 * is looking for its result there.
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

/**
 * One block per summary the model received, in the order it received them.
 *
 * A task can have more than one summary in force — two compactions whose
 * ranges do not contain each other — and the model was given both.
 */
const summaryBlocks = computed(() =>
  props.compacted.summaries.map((summary) => ({ html: renderMarkdown(summary) })),
)

/**
 * How much of a compacted turn the expanded list shows. The tool results in
 * a long conversation run to pages each; the list is there to show what was
 * folded away, not to re-render the chat.
 */
const TURN_PREVIEW_CHARS = 160

const turns = computed(() =>
  props.compacted.rows.map((row) => ({ row, text: turnText(row) })),
)

const headerLabel = computed<string>(() => {
  const count = turns.value.length
  if (count === 0) {
    return t('Conversation compacted')
  }
  return count === 1
    ? t('{count} message compacted', { count })
    : t('{count} messages compacted', { count })
})

function turnText(row: HistoryEntry): string {
  if (row.content && row.content.trim() !== '') return row.content
  const text = (row.content_blocks ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
  return text.trim()
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= TURN_PREVIEW_CHARS) return flat
  return `${flat.slice(0, TURN_PREVIEW_CHARS)}…`
}
</script>

<template>
  <div
    class="shrink-0 border-b border-border bg-background"
    data-testid="compacted-history"
  >
    <button
      type="button"
      class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
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
      class="max-h-[40vh] overflow-y-auto border-t border-border px-4 py-3 text-sm"
      data-testid="compacted-history-details"
    >
      <p class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {{ t('What the model was told') }}
      </p>
      <div class="space-y-2">
        <div
          v-for="(summary, index) in summaryBlocks"
          :key="index"
          class="chat-bubble-content text-foreground"
          :data-testid="`compacted-summary-${index}`"
          v-html="summary.html"
        />
      </div>

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
          <span
            v-if="turn.row.tool_name"
            class="font-medium"
          >· {{ turn.row.tool_name }}</span>
          <span class="whitespace-pre-wrap break-words">{{ preview(turn.text) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
