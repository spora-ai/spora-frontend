<script setup lang="ts">
/**
 * DashboardToolbar — the search + sort + "updated Xs ago" row that sits
 * between the KPI strip and the chip row.
 *
 * The search input is a `SearchInput` that mirrors its own `localQuery` ref
 * so keystrokes render immediately. The local value is also fed into
 * `useDebounce(..., 200ms)` so the debounced `search.value` becomes the
 * source-of-truth forwarded to `useDashboardData().setQuery(...)`. We
 * debounce to avoid recomputing the agent filter (and re-rendering every
 * card) on every keystroke.
 *
 * "Updated Xs ago" reads `useDashboardData().lastUpdatedAt` and re-renders
 * every 5 seconds via a `setInterval` started in `onMounted` / cleared
 * in `onUnmounted`. The interval exists to keep the *label* fresh without
 * triggering a refetch — `refresh()` is the header's job.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useDashboardData, type DashboardSort } from '@/composables/useDashboardData'
import { useDebounce } from '@/composables/useDebounce'
import SearchInput from '@/components/ui/SearchInput.vue'

const { state, setQuery, setSort, lastUpdatedAt } = useDashboardData()

interface SortOption {
  value: DashboardSort
  label: string
}

const SORT_OPTIONS: ReadonlyArray<SortOption> = [
  { value: 'activity', label: 'Last activity' },
  { value: 'name', label: 'Name' },
  { value: 'created', label: 'Recently created' },
  { value: 'tasks', label: 'Task count' },
]

// `localQuery` updates immediately on every keystroke so the field doesn't
// go blank during the 200 ms debounce window; `search` is the debounced
// source-of-truth forwarded to useDashboardData.
const localQuery = ref<string>(state.query.value)
const search = useDebounce<string>(state.query.value, 200)

watch(search.value, (next) => {
  setQuery(next)
})

function onSearchInput(next: string): void {
  localQuery.value = next
  search.set(next)
}

function onSortChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  setSort(target.value as DashboardSort)
}

/**
 * Wall-clock time we re-render the "Updated Xs ago" label against. The
 * 5-second tick keeps the label fresh without touching any store data.
 */
const now = ref<number>(Date.now())
let tickId: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  tickId = setInterval(() => {
    now.value = Date.now()
  }, 5000)
})

onUnmounted(() => {
  if (tickId !== null) {
    clearInterval(tickId)
    tickId = null
  }
})

const updatedLabel = computed<string>(() => {
  const at = lastUpdatedAt.value
  if (at === null) return ''
  const diffMs = Math.max(0, now.value - at.getTime())
  const sec = Math.round(diffMs / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  return `${hr}h ago`
})
</script>

<template>
  <div class="mt-6 flex flex-wrap items-center gap-3 border-y border-border py-3">
    <div class="relative min-w-[260px] flex-1 basis-[260px]">
      <SearchInput
        :model-value="localQuery"
        placeholder="Search by name, description, or tool…"
        @update:model-value="onSearchInput"
      />
    </div>
    <div class="flex items-center gap-3 text-xs">
      <label class="inline-flex items-center gap-1.5 text-muted-foreground">
        <span>Sort</span>
        <select
          :value="state.sort.value"
          aria-label="Sort agents"
          class="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          @change="onSortChange"
        >
          <option
            v-for="opt in SORT_OPTIONS"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </label>
      <span
        v-if="updatedLabel"
        class="toolbar-updated hidden text-muted-foreground sm:inline"
      >
        &middot; Updated {{ updatedLabel }}
      </span>
    </div>
  </div>
</template>
