<script setup lang="ts">
/**
 * TaskChatAbortButton — icon-only abort affordance shown below the typing
 * indicator while a task is RUNNING.
 *
 * Single-click abort; the store action does NOT optimistic-update (mirrors
 * `useTaskChatApprovals` — await the server, then refetch). Errors surface
 * as a toast via the store.
 *
 * The component does not know about cascades or rollbacks — it only fires the
 * abort and lets the store reconcile the task and any affected ancestors.
 */
import Icon from '@/components/ui/Icon.vue'

defineProps<{
  /** Disables the button while the request is in flight. */
  submitting: boolean
}>()

const emit = defineEmits<{
  abort: []
}>()

function onClick(): void {
  emit('abort')
}
</script>

<template>
  <div class="ml-9 mt-1.5 flex items-center gap-2">
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/40 px-1.5 py-0.5 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
      :disabled="submitting"
      aria-label="Abort agent loop"
      title="Abort after the current tool — type a follow-up to resume"
      data-testid="abort-button"
      @click="onClick"
    >
      <Icon name="x-circle" class="h-3.5 w-3.5 shrink-0" />
      <span class="text-[11px] font-medium">Abort</span>
    </button>
  </div>
</template>
