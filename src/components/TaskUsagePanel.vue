<script setup lang="ts">
/**
 * TaskUsagePanel — compact LLM usage + cache observability for a task.
 *
 * Mounted inside the chat header on the task detail page. Two visual
 * states, driven by the same `CollapsibleRoot`:
 *
 * 1. **Compact (default)** — a small inline pill showing
 *    `Input · Output · Cache hit` plus a `[Show details]` link. Lives
 *    next to the task title in the chat header so operators always see
 *    headline cost signals without scrolling.
 * 2. **Details (expanded)** — provider tag, reasoning counter, and the
 *    per-turn table. The cache-split columns (Cache read / Cache create)
 *    are gated by `provider === 'anthropic'` because OpenAI does not
 *    surface those counters — only `cached_tokens`, already covered by
 *    the Cache hit %.
 *
 * Provider-specific empty-state copy nudges the operator toward the
 * right next step when their cache hit rate is zero:
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

// `derivedTotals` is the per-row aggregate from `useTaskUsageTotals`
// itself; the server's `totals` block is the primary source but the
// store nullifies it on incremental fetches (so the panel re-derives
// from history) — see `stores/tasks.ts#fetchTaskDetail`.
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

// Provider resolution: prefer the most recent assistant usage row from
// history (so the dominant provider matches what the user sees in the
// per-turn table), then fall back to the totals prop's provider when
// history is empty. Reading the totals prop directly — rather than via
// `headlineTotals` — keeps the two computeds acyclic.
const totalsProvider = computed<UsageProvider>(() => props.totals?.provider ?? 'unknown')

const provider = computed<UsageProvider>(() => {
  const rows = props.history ?? []
  let lastProvider: UsageProvider | undefined
  for (let i = rows.length - 1; i >= 0; i--) {
    const h = rows[i]
    if (h && h.role === 'assistant' && h.usage) {
      lastProvider = h.usage.provider
      break
    }
  }
  return lastProvider ?? totalsProvider.value
})

// `headlineTotals` is the server-supplied `totals` prop when present,
// and the per-row `derivedTotals` otherwise. The resolved `provider` is
// merged into the result so `cacheHitRate()` picks the right denominator
// (Anthropic sums input + cache_read + cache_creation; OpenAI divides
// cached_tokens / input_tokens). Without this merge the server-side
// aggregate has `provider: undefined` at runtime and the cache hit
// silently drops to 0% for Anthropic data — see Bug A in the PR.
const headlineTotals = computed<Usage | null>(() => {
  const resolved = provider.value
  if (props.totals) {
    return resolved === 'unknown' ? props.totals : { ...props.totals, provider: resolved }
  }
  return resolved !== 'unknown'
    ? { ...derivedTotals.value, provider: resolved }
    : derivedTotals.value
})

const overallHitRate = computed<number | null>(() => {
  if (!headlineTotals.value) return null
  return cacheHitRate(headlineTotals.value)
})

const hasAnyUsage = computed(() => perTurn.value.length > 0)

const hasReasoning = computed(() => (headlineTotals.value?.reasoning_tokens ?? 0) > 0)

// Cache split columns are Anthropic-only. OpenAI does not surface
// `cache_read_tokens` / `cache_creation_tokens` (the chat-completions
// API only reports `cached_tokens`, which is already inside the
// Cache hit %) so showing those columns for OpenAI would just be
// zeros — misleading and noisy.
const showCacheSplit = computed(() => provider.value === 'anthropic')

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
  <CollapsibleRoot v-slot="{ open }" v-model:open="expanded" class="min-w-0">
    <div class="flex items-center gap-3 min-w-0" data-testid="usage-compact">
      <div v-if="!hasAnyUsage" class="flex-1 min-w-0 text-xs text-muted-foreground truncate" data-testid="usage-empty">
        {{ emptyStateMessage(provider) }}
      </div>
      <div v-else class="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="usage-summary">
        <span class="whitespace-nowrap">
          <span class="text-muted-foreground">Input</span>
          <span class="ml-1 font-semibold text-foreground">{{ formatTokenCount(headlineTotals?.input_tokens ?? 0) }}</span>
        </span>
        <span class="whitespace-nowrap">
          <span class="text-muted-foreground">Output</span>
          <span class="ml-1 font-semibold text-foreground">{{ formatTokenCount(headlineTotals?.output_tokens ?? 0) }}</span>
        </span>
        <span
          v-if="overallHitRate !== null"
          class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
          data-testid="usage-cache-hit"
          :class="hitRateTone(overallHitRate).classes"
        >
          Cache hit {{ hitRateTone(overallHitRate).label }}
        </span>
      </div>
      <CollapsibleTrigger
        class="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        :aria-label="open ? 'Hide usage details' : 'Show usage details'"
        data-testid="usage-toggle"
      >
        <Icon name="chevron-right" class="h-3 w-3 transition-transform" :class="{ 'rotate-90': open }" />
        {{ open ? 'Hide' : 'Show' }} details
      </CollapsibleTrigger>
    </div>
    <CollapsibleContent>
      <div v-if="hasAnyUsage" class="mt-2 border-t border-border pt-2" data-testid="usage-per-turn">
        <div class="flex items-center gap-2 px-1 pb-2">
          <h3 class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Provider</h3>
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
        <table class="w-full text-xs">
          <thead class="bg-muted/50 text-muted-foreground">
            <tr>
              <th class="px-4 py-1.5 text-left font-medium">Turn</th>
              <th class="px-2 py-1.5 text-right font-medium">Input</th>
              <th class="px-2 py-1.5 text-right font-medium">Output</th>
              <th v-if="hasReasoning" class="px-2 py-1.5 text-right font-medium">Reasoning</th>
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
              <td class="px-4 py-1.5 text-muted-foreground">#{{ turn.index }}</td>
              <td class="px-2 py-1.5 text-right font-mono">{{ formatTokenCount(turn.usage.input_tokens) }}</td>
              <td class="px-2 py-1.5 text-right font-mono">{{ formatTokenCount(turn.usage.output_tokens) }}</td>
              <td v-if="hasReasoning" class="px-2 py-1.5 text-right font-mono">{{ formatTokenCount(turn.usage.reasoning_tokens) }}</td>
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
      <div v-else class="mt-2 border-t border-border pt-2 px-1 text-xs text-muted-foreground">
        {{ emptyStateMessage(provider) }}
      </div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
