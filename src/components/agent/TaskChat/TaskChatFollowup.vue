<script setup lang="ts">
/**
 * TaskChatFollowup — the bottom follow-up input bar.
 *
 * Shown when the task is COMPLETED or FAILED and the agent allows
 * continuation. The page owns the state via `useTaskChatFollowup` and passes
 * the values + submit handler in as props so this component stays
 * presentational.
 */
import { computed } from 'vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'

interface Props {
  showFollowupBar: boolean
  followupPrompt: string
  submittingFollowup: boolean
  followupError: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  updateFollowupPrompt: [value: string]
  submitFollowup: []
}>()

// Two-way binding adapter: MarkdownEditor emits `update:modelValue`, but
// the parent page subscribes to our `updateFollowupPrompt` event.
const promptModel = computed({
  get: () => props.followupPrompt,
  set: (v: string) => emit('updateFollowupPrompt', v),
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    emit('submitFollowup')
  }
}
</script>

<template>
  <div
    v-if="showFollowupBar"
    class="border-t border-border bg-background shrink-0"
  >
    <div class="max-w-2xl w-full mx-auto px-4 py-4 flex flex-col gap-2">
      <p class="text-xs text-muted-foreground font-medium">Continue conversation</p>
      <div class="flex items-end gap-3">
        <div class="flex-1">
          <MarkdownEditor
            v-model="promptModel"
            mode="bubble"
            :rows="1"
            :disabled="submittingFollowup"
            placeholder="Ask a follow-up question…"
            @keydown="onKeydown"
          />
        </div>
        <button
          data-testid="send-followup"
          @click="emit('submitFollowup')"
          :disabled="submittingFollowup || !followupPrompt.trim()"
          class="shrink-0 h-10 rounded-lg bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center px-4 text-sm font-medium"
        >
          {{ submittingFollowup ? 'Sending…' : 'Send' }}
        </button>
      </div>
      <p v-if="followupError" role="alert" data-testid="followup-error" class="text-xs text-destructive">{{ followupError }}</p>
    </div>
  </div>
</template>
