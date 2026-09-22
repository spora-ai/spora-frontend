<script setup lang="ts">
/**
 * AgentToolsToolbar — search + status segmented filter + category multi-select.
 *
 * Three v-model'd controls consumed by AgentToolsSection:
 *   v-model:search      string
 *   v-model:status      'all' | 'enabled' | 'needs-setup' | 'off'
 *   v-model:categories  Set<string>  (empty Set = all categories)
 *
 * Categories are presented as a native <details> dropdown with a checkbox
 * list — no Radix dependency, matches the styling of KebabMenu /
 * ListItemButton. The summary text updates dynamically:
 *   0 selected       → "All categories"
 *   1 selected       → "<Label>"
 *   N>1 selected     → "N categories"
 */
import { computed } from 'vue'
import SearchInput from '@/components/ui/SearchInput.vue'

export interface CategoryOption {
  key: string
  label: string
  count: number
}

export interface StatusCounts {
  all: number
  enabled: number
  needsSetup: number
  off: number
}

export type StatusFilter = 'all' | 'enabled' | 'needs-setup' | 'off'

const props = defineProps<{
  categories: CategoryOption[]
  statusCounts: StatusCounts
}>()

const search = defineModel<string>('search', { default: '' })
const status = defineModel<StatusFilter>('status', { default: 'all' })
const selected = defineModel<Set<string>>('selected', { default: () => new Set<string>() })

const statusOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'needs-setup', label: 'Needs setup' },
  { value: 'off', label: 'Off' },
]

const summaryLabel = computed<string>(() => {
  if (selected.value.size === 0) return 'All categories'
  if (selected.value.size === 1) {
    const only = [...selected.value][0]
    return props.categories.find((c) => c.key === only)?.label ?? only
  }
  return `${selected.value.size} categories`
})

function isCategoryChecked(key: string): boolean {
  return selected.value.has(key)
}

function toggleCategory(key: string): void {
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

function clearCategories(): void {
  selected.value = new Set<string>()
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="min-w-[200px] flex-1">
        <SearchInput
          v-model="search"
          placeholder="Search tools, descriptions, operations…"
          aria-label="Search tools"
        />
      </div>

      <div
        role="tablist"
        aria-label="Filter tools by status"
        class="inline-flex shrink-0 rounded-lg border border-border bg-background p-0.5"
      >
        <button
          v-for="opt in statusOptions"
          :key="opt.value"
          type="button"
          role="tab"
          :aria-selected="status === opt.value"
          :data-testid="`status-filter-${opt.value}`"
          class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors"
          :class="status === opt.value ? 'seg-active bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="status = opt.value"
        >
          {{ opt.label }}
          <span
            class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            :class="status === opt.value ? 'bg-background/80 text-foreground' : 'bg-muted text-muted-foreground'"
          >
            {{ opt.value === 'all' ? statusCounts.all : opt.value === 'enabled' ? statusCounts.enabled : opt.value === 'needs-setup' ? statusCounts.needsSetup : statusCounts.off }}
          </span>
        </button>
      </div>

      <details
        class="relative shrink-0"
        data-testid="category-filter"
      >
        <summary
          class="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden"
        >
          {{ summaryLabel }}
          <svg
            class="h-3 w-3 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div class="absolute right-0 top-9 z-20 min-w-[220px] rounded-lg border border-border bg-popover p-1.5 shadow-lg">
          <button
            v-if="selected.size > 0"
            type="button"
            class="mb-1 block w-full rounded px-2 py-1 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            @click="clearCategories"
          >
            Clear selection
          </button>
          <label
            v-for="cat in props.categories"
            :key="cat.key"
            class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
          >
            <input
              type="checkbox"
              :checked="isCategoryChecked(cat.key)"
              class="h-3.5 w-3.5 rounded border-border text-primary focus:ring-1 focus:ring-ring"
              @change="toggleCategory(cat.key)"
            >
            <span class="flex-1">{{ cat.label }}</span>
            <span class="text-[10px] text-muted-foreground">{{ cat.count }}</span>
          </label>
        </div>
      </details>
    </div>
  </div>
</template>
