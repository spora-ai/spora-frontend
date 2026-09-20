<script setup lang="ts">
/**
 * Renders a `todo` tool-result row in the chat timeline.
 *
 * The tool writes a markdown-rendered checklist into `result_content`
 * and the structured state into `result_data.items`. The chat surface
 * is a compact "Plan updated" row that expands on click to reveal the
 * rendered list — operators see the agent commit to a plan without
 * scrolling through raw JSON.
 */
import { ref } from 'vue'
import type { ToolCall } from '@/types/task'
import Icon from '@/components/ui/Icon.vue'

interface Props {
  toolCall: ToolCall
}

defineProps<Props>()

const expanded = ref(false)

function toggle(): void {
  expanded.value = !expanded.value
}
</script>

<template>
  <div
    class="ml-9 max-w-[85%] text-xs"
    data-testid="todo-tool-call"
  >
    <div class="rounded-lg border border-border bg-muted/40 overflow-hidden">
      <button
        type="button"
        :aria-expanded="expanded"
        aria-controls="todo-tool-call-body"
        class="flex items-center gap-2 w-full px-3 py-2 cursor-pointer hover:bg-muted/60 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
        data-testid="todo-tool-call-toggle"
        @click="toggle"
      >
        <Icon
          :name="expanded ? 'chevron-down' : 'chevron-right'"
          class="h-3 w-3 text-muted-foreground shrink-0"
        />
        <Icon
          name="check-circle"
          class="h-3.5 w-3.5 text-muted-foreground shrink-0"
        />
        <span class="font-mono font-medium text-muted-foreground">todo</span>
        <span class="text-muted-foreground/60">— plan updated</span>
      </button>
      <div
        v-if="expanded"
        id="todo-tool-call-body"
        class="px-3 py-2 border-t border-border chat-bubble-content text-muted-foreground break-all whitespace-pre-wrap"
      >
        {{ toolCall.result_content ?? '' }}
      </div>
    </div>
  </div>
</template>
