<script setup lang="ts">
/**
 * `TodoCompactStrip` — one-line collapsed-state indicator that lives
 * above the chat composer. Same data as `TodoProgressPanel` so the
 * two surfaces stay in sync without duplicating state.
 *
 * Doubles as the reopen affordance: when the full panel is closed,
 * the strip is the persistent reminder that there is a plan, and a
 * tap (or Enter / Space on a keyboard) reopens the panel. On viewports
 * below `lg` it opens the popover; on `lg+` it un-collapses the rail.
 * The parent decides the open target by setting the corresponding flag
 * from the `open` handler — both flags are independent and Tailwind
 * keeps the off-viewport surface hidden, so the handler can set both
 * without worrying about which viewport the user is on.
 *
 * The component itself does NOT carry `lg:hidden`. Visibility is
 * owned by the parent so a single v-if + :class controls both the
 * mobile and desktop collapsed-state cases. Renders `N/M · <activeForm>`
 * (or the first pending item when no task is in flight) plus a thin
 * progress bar.
 */
import { computed } from 'vue'
import { useTaskStore } from '@/stores/tasks'
import type { TodoItem } from '@/types/task'
import Icon from '@/components/ui/Icon.vue'

const taskStore = useTaskStore()

const todos = computed<TodoItem[]>(() => taskStore.pendingTodos?.items ?? [])

const totals = computed(() => {
  const done = todos.value.filter((item) => item.status === 'completed').length
  return {
    total: todos.value.length,
    done,
  }
})

const activeLabel = computed<string>(() => {
  const inProgress = todos.value.find((item) => item.status === 'in_progress')
  if (inProgress) return inProgress.activeForm ?? inProgress.content
  const firstPending = todos.value.find((item) => item.status === 'pending')
  if (firstPending) return firstPending.activeForm ?? firstPending.content
  return ''
})

const progressPercent = computed<number>(() => {
  if (totals.value.total === 0) return 0
  return Math.round((totals.value.done / totals.value.total) * 100)
})

const emit = defineEmits<{ open: [] }>()

function openPopover(): void {
  emit('open')
}
</script>

<template>
  <div
    class="border-t border-border bg-background px-4 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
    data-testid="todo-compact-strip"
    role="button"
    tabindex="0"
    aria-label="Open task status"
    @click="openPopover"
    @keydown.enter="openPopover"
    @keydown.space.prevent="openPopover"
  >
    <div class="max-w-3xl mx-auto flex items-center gap-3">
      <Icon
        name="check-circle"
        class="h-3.5 w-3.5 text-muted-foreground shrink-0"
      />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 text-xs">
          <span
            class="font-semibold tabular-nums"
            data-testid="todo-compact-done"
          >{{ totals.done }}</span>
          <span class="text-muted-foreground">/</span>
          <span
            class="text-muted-foreground tabular-nums"
            data-testid="todo-compact-total"
          >{{ totals.total }}</span>
          <span
            v-if="activeLabel"
            class="ml-2 truncate"
            data-testid="todo-compact-active"
          >{{ activeLabel }}</span>
        </div>
        <div class="mt-1 h-1 rounded-full bg-muted overflow-hidden">
          <div
            class="h-full bg-primary rounded-full transition-all"
            :style="{ width: `${progressPercent}%` }"
            data-testid="todo-compact-bar"
          />
        </div>
      </div>
    </div>
  </div>
</template>
