<script setup lang="ts">
/**
 * TaskUsageDetails — provider tag + per-turn table for the chat details.
 *
 * Renders ONLY the expanded details body: the provider tag and the
 * per-turn breakdown, gated on a parent-owned `detailsOpen` boolean
 * (v-modeled from the matching `TaskUsageSummary` toggle). The summary
 * lives INSIDE the chat header; this details panel renders as a
 * sibling below the header, above the chat banners and message list.
 *
 * The details table shows the Cache read / Cache create columns only
 * for Anthropic — OpenAI's Chat Completions API never reports those
 * counters (only `cached_tokens`, already covered by the Cache hit %).
 */
import { computed } from 'vue'
import { useTaskUsagePanel } from '@/composables/useTaskUsagePanel'
import type { HistoryEntry } from '@/types/task'
import type { Usage, UsageProvider } from '@/types/usage'

interface Props {
  history: HistoryEntry[]
  totals: Usage | null
  /**
   * Whether the details panel is currently visible. Owned by the
   * parent page so the summary's toggle (which lives in the chat
   * header) can flip it.
   */
  detailsOpen: boolean
  /**
   * The resolved provider, forwarded from the summary so the panel
   * header and the table use the same provider signal. Optional —
   * when omitted the panel derives it from `history` itself.
   */
  provider?: UsageProvider | null
}

const props = defineProps<Props>()

const historyRef = computed(() => props.history)
const totalsRef = computed(() => props.totals)

const {
  provider: derivedProvider,
  hasAnyUsage,
  perTurn,
  providerBadgeClasses: derivedProviderBadgeClasses,
  hitRateTone,
  formatTokenCount,
  emptyStateMessage,
  providerLabel,
} = useTaskUsagePanel(historyRef, totalsRef)

// The summary lives in the header and resolves the provider (most
// recent assistant row). Forwarding that resolved provider into this
// panel keeps the panel header and the table column gating in sync
// with the summary, even when the panel would otherwise derive a
// different provider from history.
const provider = computed<UsageProvider>(() => props.provider ?? derivedProvider.value)
const showCacheSplit = computed(() => provider.value === 'anthropic')

// Use the locally-resolved provider for the tag palette so the colour
// matches the forwards-passed provider, not the composable's fallback.
const providerBadgeClasses = computed(() => {
  if (provider.value === 'openai') {
    return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
  }
  if (provider.value === 'anthropic') {
    return 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
  }
  return derivedProviderBadgeClasses.value
})

const anyReasoning = computed(() => perTurn.value.some((t) => t.usage.reasoning_tokens > 0))
</script>

<template>
  <div
    v-if="detailsOpen"
    class="border-b border-border bg-muted/30 px-4 py-3"
    data-testid="usage-details"
  >
    <div class="flex items-center gap-2 mb-2">
      <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Provider</span>
      <span
        class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
        data-testid="usage-provider"
        :class="providerBadgeClasses"
      >
        {{ providerLabel(provider) }}
      </span>
    </div>
    <div v-if="hasAnyUsage" data-testid="usage-per-turn">
      <table class="w-full text-xs">
        <thead class="bg-muted/50 text-muted-foreground">
          <tr>
            <th class="px-2 py-1.5 text-left font-medium">Turn</th>
            <th class="px-2 py-1.5 text-right font-medium">Input</th>
            <th class="px-2 py-1.5 text-right font-medium">Output</th>
            <th v-if="anyReasoning" class="px-2 py-1.5 text-right font-medium">Reasoning</th>
            <th v-if="showCacheSplit" class="px-2 py-1.5 text-right font-medium">Cache read</th>
            <th v-if="showCacheSplit" class="px-2 py-1.5 text-right font-medium">Cache create</th>
            <th class="px-2 py-1.5 text-right font-medium">Hit rate</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="turn in perTurn"
            :key="turn.index"
            class="border-t border-border/60"
            :data-testid="`usage-row-${turn.index}`"
          >
            <td class="px-2 py-1.5 text-muted-foreground">#{{ turn.index }}</td>
            <td class="px-2 py-1.5 text-right font-mono">{{ formatTokenCount(turn.usage.input_tokens) }}</td>
            <td class="px-2 py-1.5 text-right font-mono">{{ formatTokenCount(turn.usage.output_tokens) }}</td>
            <td v-if="anyReasoning" class="px-2 py-1.5 text-right font-mono">{{ formatTokenCount(turn.usage.reasoning_tokens) }}</td>
            <td v-if="showCacheSplit" class="px-2 py-1.5 text-right font-mono">{{ formatTokenCount(turn.usage.cache_read_tokens) }}</td>
            <td v-if="showCacheSplit" class="px-2 py-1.5 text-right font-mono">{{ formatTokenCount(turn.usage.cache_creation_tokens) }}</td>
            <td class="px-2 py-1.5 text-right">
              <span
                class="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                :class="hitRateTone(turn.cacheHitRate).classes"
              >
                {{ hitRateTone(turn.cacheHitRate).label }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="text-xs text-muted-foreground">
      {{ emptyStateMessage(provider) }}
    </div>
  </div>
</template>
