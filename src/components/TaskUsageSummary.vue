<script setup lang="ts">
/**
 * TaskUsageSummary — compact LLM usage summary for the chat header.
 *
 * Renders ONLY the always-visible two-line summary (Input · Output ·
 * Cache hit · Show/Hide details toggle). The details panel is a SEPARATE
 * sibling component (`TaskUsageDetails`) that lives below the chat
 * header. The two share a parent-owned `detailsOpen` ref via v-model so
 * a click on the toggle button here flips the details' visibility.
 *
 * No `border-b` here — the parent header already has its own border.
 * When the link is hovered the colour transitions to the foreground
 * muted-foreground token so it stays subtle.
 */
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useTaskUsagePanel } from '@/composables/useTaskUsagePanel'
import type { HistoryEntry } from '@/types/task'
import type { Usage } from '@/types/usage'

/**
 * The `detailsOpen` prop is v-modelable. The parent owns the ref so
 * the same boollan controls both this summary's toggle and the
 * sibling details panel's visibility.
 */
const detailsOpen = defineModel<boolean>('detailsOpen', { default: false })

interface Props {
  history: HistoryEntry[]
  /**
   * Server-aggregated totals. Used as the primary source for the
   * headline numbers; falls back to the per-row sum when null.
   */
  totals: Usage | null
}

const props = defineProps<Props>()

const historyRef = computed(() => props.history)
const totalsRef = computed(() => props.totals)

const {
  headlineTotals,
  overallHitRate,
  hasAnyUsage,
  hitRateTone,
  formatTokenCount,
  emptyStateMessage,
  provider,
} = useTaskUsagePanel(historyRef, totalsRef)

const showEmpty = computed(() => !hasAnyUsage.value)
</script>

<template>
  <div class="flex flex-col gap-1 min-w-0" data-testid="usage-summary">
    <div v-if="!showEmpty" class="flex items-center gap-3 text-xs" data-testid="usage-summary-row-totals">
      <span class="text-muted-foreground whitespace-nowrap">
        Input <strong class="text-foreground">{{ formatTokenCount(headlineTotals?.input_tokens ?? 0) }}</strong>
      </span>
      <span class="text-muted-foreground whitespace-nowrap">
        Output <strong class="text-foreground">{{ formatTokenCount(headlineTotals?.output_tokens ?? 0) }}</strong>
      </span>
    </div>
    <div v-else class="text-xs text-muted-foreground truncate" data-testid="usage-empty">
      {{ emptyStateMessage(provider) }}
    </div>
    <div class="flex items-center gap-3 text-xs" data-testid="usage-summary-row-actions">
      <span
        v-if="overallHitRate !== null"
        class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
        data-testid="usage-cache-hit"
        :class="hitRateTone(overallHitRate).classes"
      >
        Cache hit {{ hitRateTone(overallHitRate).label }}
      </span>
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
        :aria-label="detailsOpen ? 'Hide usage details' : 'Show usage details'"
        data-testid="usage-toggle"
        @click="detailsOpen = !detailsOpen"
      >
        <Icon name="chevron-right" class="h-3 w-3 transition-transform" :class="{ 'rotate-90': detailsOpen }" />
        {{ detailsOpen ? 'Hide details' : 'Show details' }}
      </button>
    </div>
  </div>
</template>
