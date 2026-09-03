<script setup lang="ts">
/**
 * TaskChatBanners — all banner variants for the TaskChatPage.
 *
 * Renders the retry banner, the non-retryable error banner, the auto-retry
 * countdown (3 states), and the max-steps-reached banner. The page passes
 * the relevant state as props; this component is pure presentation so it
 * stays testable in isolation.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { TaskDetail } from '@/types/task'
import { formatErrorCode } from '@/composables/useTaskChat'
import Icon from '@/components/ui/Icon.vue'

interface Props {
  task: TaskDetail | null
  showRetryBanner: boolean
  showNonRetryableErrorBanner: boolean
  nonRetryableErrorMessage: string | null
  showCountdown: boolean
  countdown: string
  canAutoRetry: boolean
  retriesExhausted: boolean
  autoRetryDisabled: boolean
  retryAttempt: number
  maxRetryAttempts: number
  cancelling: boolean
  showMaxStepsBanner: boolean
  followupPrompt: string
  submittingFollowup: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  retryNow: []
  cancelRetryChain: []
  dismissBanner: []
  updateFollowupPrompt: [value: string]
  submitFollowup: []
  /**
   * Plan C refinement: the user clicking "Send 'continue'" on the ABORTED
   * banner's Resume popover. The page is responsible for routing this
   * through `submitFollowup()` with `'continue'` as the prompt text.
   * Emitted (not handled here) because the prompt state lives in
   * `useTaskChatFollowup` on the page.
   */
  resumeSendContinue: []
}>()

const errorCodeLabel = computed(() => formatErrorCode(props.task?.error_code))

/**
 * Plan C: dispatch a `spora:focus-followup` event so the follow-up composer
 * below this banner can focus itself without TaskChatBanners needing to
 * know the composer's internals.
 *
 * The auto-focus on status flip to ABORTED (TaskChatPage.vue `watch(status)`)
 * already fires once when the banner mounts — this button is for users
 * who scrolled past the banner and want to come back to the composer.
 */
function dispatchFocusFollowup(): void {
  document.dispatchEvent(new CustomEvent('spora:focus-followup', { bubbles: true }))
}

/**
 * Plan C follow-up: the Resume affordance on the ABORTED banner reveals
 * a small popover with two options. Clicking the button itself toggles
 * the menu; each option closes the menu and dispatches its action.
 *
 * Local to this component because the menu is purely presentational —
 * the page doesn't need to know whether the menu is open or closed, only
 * which option the user picked.
 */
const showResumeMenu = ref(false)
const resumeRoot = ref<HTMLElement | null>(null)

function toggleResumeMenu(): void {
  showResumeMenu.value = !showResumeMenu.value
}

function closeResumeMenu(): void {
  showResumeMenu.value = false
}

function onResumeMenuDocumentClick(event: MouseEvent): void {
  if (!showResumeMenu.value) return
  const target = event.target as Node | null
  if (resumeRoot.value && target && !resumeRoot.value.contains(target)) {
    closeResumeMenu()
  }
}

function onResumeMenuEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape' && showResumeMenu.value) {
    closeResumeMenu()
  }
}

onMounted(() => {
  document.addEventListener('click', onResumeMenuDocumentClick)
  document.addEventListener('keydown', onResumeMenuEscape)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onResumeMenuDocumentClick)
  document.removeEventListener('keydown', onResumeMenuEscape)
})

function onResumeSendContinue(): void {
  closeResumeMenu()
  emit('resumeSendContinue')
}

function onResumeTypeMessage(): void {
  closeResumeMenu()
  dispatchFocusFollowup()
}
</script>

<template>
  <div
    v-if="showRetryBanner"
    data-testid="retry-banner"
    class="mx-4 mt-4 max-w-2xl w-full mx-auto flex items-start gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm"
  >
    <Icon name="warning" class="h-5 w-5 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
    <div class="flex-1 min-w-0">
      <p class="font-semibold text-red-900 dark:text-red-100">Task failed: {{ errorCodeLabel }}</p>
      <p v-if="task?.error_message" class="text-red-700 dark:text-red-300 mt-0.5">{{ task.error_message }}</p>
    </div>
    <button
      data-testid="retry-button"
      @click="emit('retryNow')"
      class="shrink-0 inline-flex h-8 items-center justify-center rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium shadow transition-colors px-3"
      type="button"
    >
      Retry Now
    </button>
    <button
      data-testid="dismiss-retry-banner-button"
      @click="emit('dismissBanner')"
      class="shrink-0 inline-flex h-8 items-center justify-center rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 text-xs px-2 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
      type="button"
    >
      Dismiss
    </button>
  </div>

  <div
    v-if="showNonRetryableErrorBanner"
    data-testid="non-retryable-error-banner"
    class="mx-4 mt-4 max-w-2xl mx-auto flex items-start gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm"
  >
    <Icon name="warning" class="h-5 w-5 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
    <div class="flex-1 min-w-0">
      <p class="font-semibold text-red-900 dark:text-red-100">Task failed: {{ errorCodeLabel }}</p>
      <p v-if="nonRetryableErrorMessage" class="text-red-700 dark:text-red-300 mt-0.5">{{ nonRetryableErrorMessage }}</p>
    </div>
    <button
      data-testid="retry-button-non-retryable"
      @click="emit('retryNow')"
      class="shrink-0 inline-flex h-8 items-center justify-center rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium shadow transition-colors px-3"
      type="button"
    >
      Retry Now
    </button>
    <button
      data-testid="dismiss-non-retryable-banner-button"
      @click="emit('dismissBanner')"
      class="shrink-0 inline-flex h-8 items-center justify-center rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 text-xs px-2 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
      type="button"
    >
      Dismiss
    </button>
  </div>

  <div
    v-if="showCountdown && canAutoRetry"
    data-testid="retry-countdown"
    class="mx-4 mt-4 max-w-2xl mx-auto flex items-center gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm"
  >
    <Icon name="clock" class="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
    <div class="flex-1 min-w-0">
      <p class="font-semibold text-amber-900 dark:text-amber-100">
        Retrying in {{ countdown }} — Attempt {{ retryAttempt }} of {{ maxRetryAttempts }}
      </p>
      <p v-if="task?.error_code === 'ORPHANED'" class="text-amber-700 dark:text-amber-300 mt-0.5">
        Task was interrupted. A retry attempt is scheduled automatically.
      </p>
      <p v-else class="text-amber-700 dark:text-amber-300 mt-0.5">
        Task failed and will be retried automatically.
      </p>
    </div>
    <button
      data-testid="retry-button"
      @click="emit('retryNow')"
      class="shrink-0 inline-flex h-8 items-center justify-center rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium shadow transition-colors px-3"
      type="button"
    >
      Retry Now
    </button>
    <button
      data-testid="cancel-retry-button"
      @click="emit('cancelRetryChain')"
      :disabled="cancelling"
      class="shrink-0 inline-flex h-8 items-center justify-center rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs px-3 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors disabled:opacity-50"
      type="button"
    >
      {{ cancelling ? 'Cancelling…' : 'Cancel' }}
    </button>
  </div>

  <div
    v-else-if="showCountdown && retriesExhausted"
    data-testid="retry-countdown"
    class="mx-4 mt-4 max-w-2xl mx-auto flex items-center gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm"
  >
    <Icon name="clock" class="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
    <div class="flex-1 min-w-0">
      <p class="font-semibold text-amber-900 dark:text-amber-100">All retries exhausted.</p>
      <p class="text-amber-700 dark:text-amber-300 mt-0.5">
        No more automatic retries remaining.
      </p>
    </div>
    <button
      data-testid="retry-button"
      @click="emit('retryNow')"
      class="shrink-0 inline-flex h-8 items-center justify-center rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium shadow transition-colors px-3"
      type="button"
    >
      Retry Now
    </button>
  </div>

  <div
    v-else-if="showCountdown && autoRetryDisabled"
    data-testid="retry-countdown"
    class="mx-4 mt-4 max-w-2xl mx-auto flex items-center gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm"
  >
    <Icon name="clock" class="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
    <div class="flex-1 min-w-0">
      <p class="font-semibold text-amber-900 dark:text-amber-100">Auto-retry not configured.</p>
      <p class="text-amber-700 dark:text-amber-300 mt-0.5">
        This task will not be retried automatically.
      </p>
    </div>
    <button
      data-testid="retry-button"
      @click="emit('retryNow')"
      class="shrink-0 inline-flex h-8 items-center justify-center rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium shadow transition-colors px-3"
      type="button"
    >
      Retry Now
    </button>
  </div>

  <div
    v-if="showMaxStepsBanner"
    class="mx-4 mt-4 max-w-2xl mx-auto flex items-start gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-4 text-sm"
  >
    <Icon name="warning" class="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
    <div class="flex-1 min-w-0 flex flex-col gap-3">
      <div>
        <p class="font-semibold text-amber-900 dark:text-amber-100">Max steps reached.</p>
        <p class="text-amber-700 dark:text-amber-300 mt-0.5">
          This task used all {{ task?.step_count }} step{{ task?.step_count !== 1 ? 's' : '' }} (limit: {{ task?.max_steps }}).
        </p>
      </div>

      <div class="flex flex-col gap-1.5">
        <textarea
          id="task-followup-prompt"
          aria-label="Tell the agent what to do next"
          :value="followupPrompt"
          @input="emit('updateFollowupPrompt', ($event.target as HTMLTextAreaElement).value)"
          rows="2"
          placeholder="Tell the agent what to do next…"
          class="w-full rounded-lg border border-amber-200 dark:border-amber-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-amber-900 dark:text-amber-100 placeholder:text-amber-400 dark:placeholder:text-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
        />
        <div class="flex items-center gap-2">
          <button
            @click="emit('submitFollowup')"
            :disabled="submittingFollowup || !followupPrompt.trim()"
            class="inline-flex h-8 items-center justify-center rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium shadow transition-colors px-4 disabled:pointer-events-none disabled:opacity-50"
            type="button"
          >
            {{ submittingFollowup ? 'Continuing…' : 'Reset steps & continue' }}
          </button>
          <span class="text-xs text-amber-700 dark:text-amber-300">— keeps the step limit, resets counter</span>
        </div>
      </div>
    </div>
  </div>

  <!--
    ABORTED banner — surfaced when the user halted the running agent loop.

    Plan C: the Resume button is a discoverability win — it gives the
    user an obvious "what now?" affordance instead of leaving them
    hunting for the composer below. The first iteration only focused
    the composer, but that read as a no-op: the button looks like a
    trigger, not a focus shortcut. The popover offers two distinct
    actions: send a default "continue" prompt (the most common case
    after an abort — "just keep going") or jump to the composer for a
    typed instruction.
  -->
  <div
    v-if="task?.status === 'ABORTED'"
    data-testid="aborted-banner"
    class="mx-4 mt-4 max-w-2xl mx-auto flex items-center gap-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/30 px-4 py-3 text-sm"
  >
    <Icon name="clock" class="h-5 w-5 shrink-0 text-stone-500 dark:text-stone-400" />
    <div class="flex-1 min-w-0">
      <p class="font-semibold text-stone-900 dark:text-stone-100">Aborted — send a new instruction to continue.</p>
      <p class="text-stone-600 dark:text-stone-400 mt-0.5">
        Use Resume to continue with a default prompt, or type a message below to give the agent a new instruction.
      </p>
    </div>
    <div ref="resumeRoot" class="relative shrink-0">
      <button
        type="button"
        data-testid="aborted-resume-button"
        :aria-expanded="showResumeMenu"
        aria-haspopup="menu"
        class="inline-flex items-center gap-1.5 rounded-md bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 px-3 py-1.5 text-xs font-medium hover:bg-stone-700 dark:hover:bg-stone-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500"
        @click="toggleResumeMenu"
      >
        <Icon name="play" class="h-3.5 w-3.5" />
        Resume
        <Icon name="chevron-down" class="h-3 w-3" />
      </button>
      <div
        v-if="showResumeMenu"
        data-testid="aborted-resume-menu"
        role="menu"
        class="absolute right-0 top-full mt-1 z-20 w-56 rounded-md border border-border bg-background text-foreground shadow-lg py-1 text-left"
      >
        <button
          type="button"
          role="menuitem"
          data-testid="aborted-resume-send-continue"
          class="w-full px-3 py-2 text-xs hover:bg-muted focus:bg-muted focus:outline-none"
          @click="onResumeSendContinue"
        >
          <span class="font-medium block">Send &ldquo;continue&rdquo;</span>
          <span class="block text-muted-foreground mt-0.5">Resume the task with a default prompt.</span>
        </button>
        <button
          type="button"
          role="menuitem"
          data-testid="aborted-resume-type-message"
          class="w-full px-3 py-2 text-xs hover:bg-muted focus:bg-muted focus:outline-none border-t border-border"
          @click="onResumeTypeMessage"
        >
          <span class="font-medium block">Type a message&hellip;</span>
          <span class="block text-muted-foreground mt-0.5">Focus the composer so you can write your own instruction.</span>
        </button>
      </div>
    </div>
  </div>
</template>
