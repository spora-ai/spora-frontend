<script setup lang="ts">
/**
 * TaskChatAbortButton — icon-only abort affordance shown while a task is
 * RUNNING. The store does NOT optimistically update: the button flips to
 * "Aborting…" to acknowledge the click, but the ABORTED banner waits for
 * the server. The store's `startAbortSettlingPoll` keeps polling through
 * the transition so in-flight tool output lands without a reload.
 */
import { computed } from 'vue'
import { Icon } from '@spora-ai/components/icons'

const props = defineProps<{
  /** Disables the button while the request is in flight. */
  submitting: boolean
}>()

const emit = defineEmits<{
  abort: []
}>()

function onClick(): void {
  emit('abort')
}

const label = computed<string>(() => (props.submitting ? 'Aborting…' : 'Abort'))
const ariaLabel = computed<string>(() =>
  props.submitting ? 'Aborting agent loop' : 'Abort agent loop',
)
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/40 px-1.5 py-0.5 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
    :disabled="submitting"
    :aria-label="ariaLabel"
    :aria-busy="submitting"
    :title="submitting ? 'Aborting — please wait' : 'Abort after the current tool — type a follow-up to resume'"
    data-testid="abort-button"
    @click="onClick"
  >
    <Icon
      :name="submitting ? 'loader-2' : 'x-circle'"
      :class="['h-3.5 w-3.5 shrink-0', submitting ? 'animate-spin' : '']"
    />
    <span class="text-[11px] font-medium">{{ label }}</span>
  </button>
</template>
