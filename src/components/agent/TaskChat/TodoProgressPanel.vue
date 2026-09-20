<script setup lang="ts">
/**
 * `TodoProgressPanel` — right-side task-status checklist on `lg+`.
 *
 * Same data source as `TodoCompactStrip` (the store's `pendingTodos`
 * selector, which reads from `task.data.todos`). Tailwind
 * `hidden lg:block` on the parent `<aside>` keeps this off the chat
 * column on narrow screens — the strip takes over there.
 *
 * The single `in_progress` item gets a left border + tinted background
 * to surface the agent's current focus. Stats footer (Total / Done /
 * Active / Pending) and an overall progress bar give operators a
 * glance of how far along the plan is.
 */
import { computed } from 'vue'
import { useTaskStore } from '@/stores/tasks'
import type { TodoItem } from '@/types/task'
import Icon from '@/components/ui/Icon.vue'

const taskStore = useTaskStore()

const todos = computed<TodoItem[]>(() => taskStore.pendingTodos?.items ?? [])

const inProgressItem = computed<TodoItem | null>(
  () => todos.value.find((item) => item.status === 'in_progress') ?? null,
)

const pendingItems = computed<TodoItem[]>(
  () => todos.value.filter((item) => item.status === 'pending'),
)

const completedItems = computed<TodoItem[]>(
  () => todos.value.filter((item) => item.status === 'completed'),
)

const totals = computed(() => ({
  total: todos.value.length,
  done: completedItems.value.length,
  active: inProgressItem.value === null ? 0 : 1,
  pending: pendingItems.value.length,
}))

const progressPercent = computed<number>(() => {
  if (totals.value.total === 0) return 0
  return Math.round((totals.value.done / totals.value.total) * 100)
})

function itemLabel(item: TodoItem): string {
  return item.activeForm ?? item.content
}

function itemSubtitle(item: TodoItem): string | null {
  return item.activeForm === null ? null : item.content
}
</script>

<template>
  <aside
    class="hidden lg:flex w-80 shrink-0 border-l border-border bg-background flex-col"
    data-testid="todo-progress-panel"
  >
    <div class="border-b border-border">
      <div class="px-4 py-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold">
          Task status
        </h2>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Collapse task status panel"
          data-testid="todo-progress-panel-close"
        >
          <Icon
            name="x"
            class="h-4 w-4"
          />
        </button>
      </div>
    </div>

    <div
      class="flex-1 overflow-y-auto px-4 py-3 space-y-1"
      data-testid="todo-progress-panel-body"
    >
      <div
        v-if="inProgressItem"
        class="space-y-1"
        data-testid="todo-progress-group-in-progress"
      >
        <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          In progress
        </div>
        <div class="flex items-start gap-2 px-2.5 py-2 rounded-md border-l-2 border-primary bg-muted/40">
          <div class="mt-0.5">
            <Icon
              name="loader-2"
              class="h-4 w-4 animate-spin text-primary"
            />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium">
              {{ itemLabel(inProgressItem) }}
            </div>
            <div
              v-if="itemSubtitle(inProgressItem)"
              class="text-xs text-muted-foreground"
            >
              {{ itemSubtitle(inProgressItem) }}
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="pendingItems.length > 0"
        class="space-y-1"
        data-testid="todo-progress-group-pending"
      >
        <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-4 mb-2">
          Pending
        </div>
        <div
          v-for="item in pendingItems"
          :key="item.id ?? `${item.order}-${item.content}`"
          class="flex items-start gap-2 px-2.5 py-2 rounded-md hover:bg-muted/40 transition-colors"
        >
          <div class="mt-0.5 h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="text-sm">
              {{ itemLabel(item) }}
            </div>
            <div
              v-if="itemSubtitle(item)"
              class="text-xs text-muted-foreground"
            >
              {{ itemSubtitle(item) }}
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="completedItems.length > 0"
        class="space-y-1"
        data-testid="todo-progress-group-completed"
      >
        <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-4 mb-2">
          Completed
        </div>
        <div
          v-for="item in completedItems"
          :key="item.id ?? `${item.order}-${item.content}`"
          class="flex items-start gap-2 px-2.5 py-2 rounded-md hover:bg-muted/40 transition-colors"
        >
          <div class="mt-0.5 h-4 w-4 rounded-full bg-green-600 text-white flex items-center justify-center shrink-0">
            <Icon
              name="check"
              class="h-2.5 w-2.5"
            />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm text-muted-foreground line-through">
              {{ itemLabel(item) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="border-t border-border px-4 py-3 space-y-2">
      <div
        class="h-1 rounded-full bg-muted overflow-hidden"
        data-testid="todo-progress-bar"
        role="progressbar"
        :aria-valuenow="progressPercent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="h-full bg-primary rounded-full transition-all"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
      <div
        class="text-xs text-muted-foreground flex items-center justify-between"
        data-testid="todo-progress-footer"
      >
        <span>{{ totals.done }} done</span>
        <span class="tabular-nums">{{ totals.active + totals.pending }} open</span>
      </div>
    </div>
  </aside>
</template>
