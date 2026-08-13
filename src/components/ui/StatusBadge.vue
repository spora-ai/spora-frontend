<script setup lang="ts">
import type { TaskStatus } from '@/types/task'
import Icon from '@/components/ui/Icon.vue'

/**
 * StatusBadge — generic status pill driven by TaskStatus.
 *
 * Pulse animation honors `pulse` for RUNNING, PENDING_APPROVAL, and
 * AWAITING_SUB_AGENTS — these are the states where operator attention is
 * useful. ABORTED is paused-at-user-attention but does not pulse: the
 * next conversation turn is the user's, not the worker's.
 *
 * The ABORTED entry uses the stone palette (neutral grey) deliberately so
 * it does not collide with PENDING_APPROVAL's amber or FAILED's red —
 * operators can scan a list of statuses and recognise "the user stopped
 * this" without confusion.
 */
withDefaults(defineProps<{
  status: TaskStatus
  pulse?: boolean
}>(), {
  pulse: false,
})

const label: Record<TaskStatus, string> = {
  PENDING: 'Pending',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  PENDING_APPROVAL: 'Awaiting Approval',
  CANCELLED: 'Cancelled',
  AWAITING_SUB_AGENTS: 'Awaiting Sub-agents',
  ABORTED: 'Aborted',
}

const classes: Record<TaskStatus, string> = {
  PENDING: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  RUNNING: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  COMPLETED: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  CANCELLED: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500',
  AWAITING_SUB_AGENTS: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  ABORTED: 'bg-stone-100 text-stone-700 border border-stone-200 dark:bg-stone-900/40 dark:text-stone-300 dark:border-stone-700',
}
</script>

<template>
  <span
    :class="[
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
      classes[status],
    ]"
  >
    <span
      v-if="status === 'RUNNING'"
      class="inline-block h-1.5 w-1.5 rounded-full bg-blue-500"
      :class="{ 'animate-pulse': pulse }"
    />
    <span
      v-else-if="status === 'PENDING_APPROVAL'"
      class="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
      :class="{ 'animate-pulse': pulse }"
    />
    <span
      v-else-if="status === 'AWAITING_SUB_AGENTS'"
      class="inline-block h-1.5 w-1.5 rounded-full bg-violet-500"
      :class="{ 'animate-pulse': pulse }"
    />
    <Icon
      v-else-if="status === 'ABORTED'"
      name="x-circle"
      class="h-3 w-3 shrink-0"
      aria-hidden="true"
    />
    {{ label[status] }}
  </span>
</template>
