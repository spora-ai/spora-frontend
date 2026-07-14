<script setup lang="ts">
/**
 * TaskChatFollowup — the bottom follow-up input bar.
 *
 * Shown when the task is COMPLETED or FAILED and the agent allows
 * continuation. The page owns the state via `useTaskChatFollowup` and passes
 * the values + submit handler in as props so this component stays
 * presentational.
 *
 * Visual: a single-line chat input that grows with content up to ~8 rows,
 * sits inside a light rounded border (no card shadow) so it reads as a
 * continuation prompt, not a second composer card.
 */
import { computed } from 'vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import Icon from '@/components/ui/Icon.vue'
import { isSubmitKeystroke } from '@/composables/useComposerInput'

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
  // Match the initial composer: Enter inserts a newline, Cmd/Ctrl+Enter
  // submits. Using the same shortcut in both forms avoids surprising
  // users who paste text or compose multi-line follow-ups.
  if (isSubmitKeystroke(e)) {
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
    <div class="px-4 py-3 max-w-3xl mx-auto w-full">
      <div class="flex items-end gap-2 rounded-xl border border-border bg-background focus-within:ring-2 focus-within:ring-primary/20 transition-all">
        <div class="flex-1 min-w-0">
          <MarkdownEditor
            v-model="promptModel"
            mode="bubble"
            :rows="1"
            :auto-grow="true"
            :max-rows="10"
            :disabled="submittingFollowup"
            placeholder="Ask a follow-up question… (Cmd+Enter to submit)"
            @keydown="onKeydown"
          />
        </div>
        <button
          data-testid="send-followup"
          @click="emit('submitFollowup')"
          :disabled="submittingFollowup || !followupPrompt.trim()"
          class="shrink-0 h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center"
        >
          <Icon name="arrow-right" />
        </button>
      </div>
      <p v-if="followupError" role="alert" data-testid="followup-error" class="mt-1 text-xs text-destructive">{{ followupError }}</p>
    </div>
  </div>
</template>
