<script setup lang="ts">
/**
 * TaskUsagePanel — collapsible per-task LLM usage + cache observability.
 *
 * Mounted above the chat message list on the task detail page. Surfaces
 * the same six counters the backend returns in `HistoryEntry.usage` and
 * `TaskDetail.totals`, plus a per-turn breakdown the operator can scroll
 * through. Collapsed by default — most task detail views don't need the
 * full breakdown, and keeping it collapsed preserves the chat's vertical
 * real-estate.
 *
 * Provider-specific empty-state copy intentionally nudges the operator
 * toward the right next step when their cache hit rate is zero:
 *
 * - Anthropic: "consider adding cache_control breakpoints" — Anthropic
 *   requires explicit `cache_control` markers; there is nothing to
 *   auto-tune.
 * - OpenAI: "promote stable system prompts" — OpenAI auto-caches 1024+
 *   token prefixes; the only knob is the prefix shape itself.
 * - Unknown / mixed: a neutral message.
 */
import { computed, ref } from 'vue'
import { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent } from 'radix-vue'
import Icon from '@/components/ui/Icon.vue'
import { useTaskUsageTotals, cacheHitRate } from '@/composables/useTaskUsageTotals'
import type { HistoryEntry } from '@/types/task'
import type { Usage, UsageProvider } from '@/types/usage'

interface Props {
  history: HistoryEntry[]
  /**
   * Server-aggregated totals. Used as the primary source for the
   * headline numbers; falls back to the per-row sum when null.
   */
  totals: Usage | null
}

const props = defineProps<Props>()

// `useTaskUsageTotals` is reused for the per-turn table even though the
// headline numbers come from the server-supplied `totals` prop, because
// it gives us a single source of truth (and a single place to maintain
// the cacheHitRate formula).
const { perTurn } = useTaskUsageTotals(
  computed(() => props.history),
)

// `headlineTotals` is the server-supplied `totals` prop when present,
// and a per-row aggregate from `useTaskUsageTotals` otherwise. We don't
// reuse the composable's totals for the headline because the server
// already aggregated and may have applied provider-specific rules the
// composable doesn't know about.
const derivedTotals = computed(() => {
  const rows = props.history ?? []
  return rows.reduce<Usage>(
    (acc, entry) => {
      if (entry.role !== 'assistant' || !entry.usage) return acc
      const u = entry.usage
      acc.input_tokens += u.input_tokens
      acc.output_tokens += u.output_tokens
      acc.reasoning_tokens += u.reasoning_tokens
      acc.cached_tokens += u.cached_tokens
      acc.cache_creation_tokens += u.cache_creation_tokens
      acc.cache_read_tokens += u.cache_read_tokens
      return acc
    },
    {
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      provider: 'unknown',
    },
  )
})

const headlineTotals = computed<Usage | null>(() => props.totals ?? derivedTotals.value)

const provider = computed<UsageProvider>(() => {
  // The provider on the headline totals is the per-row aggregate and
  // may be `'unknown'` when providers are mixed. Surface the dominant
  // provider from the most recent row instead so the empty-state copy
  // matches what the user actually sees in the per-turn table.
  const rows = props.history ?? []
  let lastProvider: UsageProvider | undefined
  for (let i = rows.length - 1; i >= 0; i--) {
    const h = rows[i]
    if (h && h.role === 'assistant' && h.usage) {
      lastProvider = h.usage.provider
      break
    }
  }
  return lastProvider ?? headlineTotals.value?.provider ?? 'unknown'
})

const overallHitRate = computed<number | null>(() => {
  if (!headlineTotals.value) return null
  return cacheHitRate(headlineTotals.value)
})

const hasAnyUsage = computed(() => perTurn.value.length > 0)

const expanded = ref(false)

function formatTokenCount(n: number): string {
  // Locale-formatted with a thousands separator so a 1,234,567 token
  // total reads at a glance. The panel only ever renders ints, so this
  // never produces a misleading "1.00" style value.
  return n.toLocaleString('en-US')
}

function hitRateLabel(rate: number | null): string {
  if (rate === null) return '—'
  return `${(rate * 100).toFixed(1)}%`
}

interface BadgeTone {
  label: string
  classes: string
}

function hitRateTone(rate: number | null): BadgeTone {
  if (rate === null) {
    return { label: '—', classes: 'bg-muted text-muted-foreground' }
  }
  if (rate >= 0.5) {
    return { label: hitRateLabel(rate), classes: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' }
  }
  if (rate >= 0.2) {
    return { label: hitRateLabel(rate), classes: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' }
  }
  return { label: hitRateLabel(rate), classes: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' }
}

function emptyStateMessage(p: UsageProvider): string {
  if (p === 'anthropic') {
    return 'No cache hits yet — consider adding cache_control breakpoints.'
  }
  if (p === 'openai') {
    return 'OpenAI auto-caches 1024+ token prefixes — promote stable system prompts.'
  }
  return 'No cache hits yet — usage will appear here once the LLM driver reports it.'
}

function providerLabel(p: UsageProvider): string {
  if (p === 'anthropic') return 'Anthropic'
  if (p === 'openai') return 'OpenAI'
  return 'Unknown provider'
}
</script>

<template>
  <CollapsibleRoot v-slot="{ open }" v-model:open="expanded" class="border-b border-border bg-muted/30">
    <div class="px-4 py-3 flex items-center gap-3">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">LLM usage</h2>
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
            data-testid="usage-provider"
            :class="{
              'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300': provider === 'openai',
              'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300': provider === 'anthropic',
              'bg-muted text-muted-foreground': provider === 'unknown',
            }"
          >
            {{ providerLabel(provider) }}
          </span>
        </div>
        <p v-if="!hasAnyUsage" class="mt-1 text-xs text-muted-foreground" data-testid="usage-empty">
          {{ emptyStateMessage(provider) }}
        </p>
        <div v-else class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" data-testid="usage-summary">
          <span>
            <span class="text-muted-foreground">Input</span>
            <span class="ml-1 font-semibold text-foreground">{{ formatTokenCount(headlineTotals?.input_tokens ?? 0) }}</span>
          </span>
          <span>
            <span class="text-muted-foreground">Output</span>
            <span class="ml-1 font-semibold text-foreground">{{ formatTokenCount(headlineTotals?.output_tokens ?? 0) }}</span>
          </span>
          <span v-if="(headlineTotals?.reasoning_tokens ?? 0) > 0">
            <span class="text-muted-foreground">Reasoning</span>
            <span class="ml-1 font-semibold text-foreground">{{ formatTokenCount(headlineTotals?.reasoning_tokens ?? 0) }}</span>
          </span>
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
            data-testid="usage-cache-hit"
            :class="hitRateTone(overallHitRate).classes"
          >
            Cache hit {{ hitRateTone(overallHitRate).label }}
          </span>
        </div>
      </div>
      <CollapsibleTrigger
        class="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        :aria-label="open ? 'Hide per-turn breakdown' : 'Show per-turn breakdown'"
        data-testid="usage-toggle"
      >
        <Icon name="chevron-right" class="h-3 w-3 transition-transform" :class="{ 'rotate-90': open }" />
        {{ open ? 'Hide' : 'Show' }} breakdown
      </CollapsibleTrigger>
    </div>
    <CollapsibleContent>
      <div v-if="hasAnyUsage" class="border-t border-border" data-testid="usage-per-turn">
        <table class="w-full text-xs">
          <thead class="bg-muted/50 text-muted-foreground">
            <tr>
              <th class="px-4 py-1.5 text-left font-medium">Turn</th>
              <th class="px-2 py-1.5 text-right font-medium">Input</th>
              <th class="px-2 py-1.5 text-right font-medium">Output</th>
              <th class="px-2 py-1.5 text-right font-medium">Reasoning</th>
              <th class="px-2 py-1.5 text-right font-medium">Cache read</th>
              <th class="px-2 py-1.5 text-right font-medium">Cache create</th>
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
              <td class="px-4 py-1.5 text-muted-foreground">#{{ turn.index }}</td>
              <td class="px-2 py-1.5 text-right font-mono">{{ formatTokenCount(turn.usage.input_tokens) }}</td>
              <td class="px-2 py-1.5 text-right font-mono">{{ formatTokenCount(turn.usage.output_tokens) }}</td>
              <td class="px-2 py-1.5 text-right font-mono">{{ formatTokenCount(turn.usage.reasoning_tokens) }}</td>
              <td class="px-2 py-1.5 text-right font-mono">{{ formatTokenCount(turn.usage.cache_read_tokens) }}</td>
              <td class="px-2 py-1.5 text-right font-mono">{{ formatTokenCount(turn.usage.cache_creation_tokens) }}</td>
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
      <div v-else class="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        {{ emptyStateMessage(provider) }}
      </div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
