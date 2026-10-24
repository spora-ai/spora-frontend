<script setup lang="ts">
/**
 * TaskChatScrollToBottom — the "jump to the newest message" control.
 *
 * The page shows it while the operator reads above the newest message;
 * it takes the transcript back down.
 *
 * The wrapper is `sticky` rather than `absolute`: the chat scrolls in the
 * layout's scroll surface, not in a box of its own, so an absolutely
 * positioned button would sit at the end of the whole transcript instead
 * of at the bottom of the visible area. It takes no height of its own —
 * the button floats over the transcript.
 */
import { Icon } from '@spora-ai/components/icons'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const emit = defineEmits<{
  resume: []
}>()
</script>

<template>
  <div class="sticky bottom-4 z-20 h-0 self-end mr-4 pointer-events-none">
    <button
      type="button"
      class="pointer-events-auto absolute bottom-0 right-0 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
      data-testid="chat-scroll-to-bottom"
      :aria-label="t('Jump to the latest message')"
      @click="emit('resume')"
    >
      <Icon
        name="chevron-down"
        class="h-4 w-4"
      />
    </button>
  </div>
</template>
