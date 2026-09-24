<script setup lang="ts">
/**
 * TaskChatPage — task detail / chat view. Route: /tasks/:id.
 *
 * The page is a layout shell that wires the task store to focused
 * composables (retry, approvals, followup) and renders the chat area via
 * sub-components (banners, message list, approval bar, followup input).
 *
 * The LLM usage UI is split across two sibling components:
 *
 * - `TaskUsageSummary` lives INSIDE the chat header (right side, max
 *   60% width) and renders the compact Input / Output + Cache hit badge
 *   plus a Show/Hide details toggle.
 * - `TaskUsageDetails` renders as a sibling below the chat header, above
 *   the banners and message list, and shows the provider tag and the
 *   per-turn breakdown.
 *
 * The two share a single `detailsOpen` ref owned by the page so the
 * summary's toggle flips the details' visibility.
 */
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTaskStore } from '@/stores/tasks'
import { useAgentStore } from '@/stores/agent'
import { useTaskChatRetry } from '@/composables/useTaskChatRetry'
import { useTaskChatApprovals } from '@/composables/useTaskChatApprovals'
import { useTaskChatFollowup } from '@/composables/useTaskChatFollowup'
import { useMediaAllowedTypes } from '@/composables/useMediaAllowedTypes'
import { clearMediaAssetCache } from '@/composables/useMediaAssetCache'
import { useToast } from '@/composables/useToast'
import { buildChatMessages } from '@/composables/useTaskChat'
import type { TaskDetail } from '@/types/task'
import AgentLayout from '@/components/layout/AgentLayout.vue'
import TaskStatusBadge from '@/components/TaskStatusBadge.vue'
import ToolApprovalBar from '@/components/agent/ToolApprovalBar.vue'
import TaskChatBanners from '@/components/agent/TaskChat/TaskChatBanners.vue'
import TaskChatMessageList from '@/components/agent/TaskChat/TaskChatMessageList.vue'
import TaskChatFollowup from '@/components/agent/TaskChat/TaskChatFollowup.vue'
import TodoProgressPanel from '@/components/agent/TaskChat/TodoProgressPanel.vue'
import TodoCompactStrip from '@/components/agent/TaskChat/TodoCompactStrip.vue'
import AskUserQuestionCard from '@/components/agent/TaskChat/AskUserQuestionCard.vue'
import TaskUsageSummary from '@/components/TaskUsageSummary.vue'
import TaskUsageDetails from '@/components/TaskUsageDetails.vue'

const route = useRoute()
const router = useRouter()
const taskStore = useTaskStore()
const agentStore = useAgentStore()
const allowedTypes = useMediaAllowedTypes()

const taskId = computed(() => Number(route.params.id))
const task = computed(() => taskStore.activeTask)
const currentTask = computed(() => task.value as TaskDetail | null)
const pending = computed(() => taskStore.pendingToolCalls)
/**
 * First outstanding `ask_user_question` batch — drives the bottom-of-
 * chat picker. `null` hides the picker so the composer (when shown)
 * stays the only input surface. The store re-evaluates this on every
 * SSE merge, so a freshly-issued batch mounts the card without a
 * router navigation.
 */
const activePendingQuestionBatch = computed(() => taskStore.pendingQuestions?.[0] ?? null)
const hasTodos = computed(() => (taskStore.pendingTodos?.items.length ?? 0) > 0)
const composerEnabled = computed(() => task.value?.status !== 'AWAITING_INPUT')

/**
 * Two component-local visibility flags for the todo panel — desktop
 * rail vs mobile popover. They're deliberately independent: a single
 * boolean would need viewport detection to decide which surface to
 * mount, and a viewport change mid-session (resize / device rotation)
 * would silently swap the wrong surface closed. Separate refs keep
 * each surface's state scoped to its trigger (X-close on desktop,
 * strip-tap on mobile), and the close handler clears both at once
 * so the two surfaces can never be simultaneously open.
 */
const sidebarCollapsed = ref(false)
const mobilePopoverOpen = ref(false)
const mobilePopoverBackdropRef = ref<HTMLDivElement | null>(null)

/**
 * Focus the backdrop on mount so its `keydown.esc` handler is the
 * active keyboard target for "close modal". The backdrop is
 * `tabindex="-1"` so it stays out of the Tab order but still accepts
 * a programmatic `.focus()` call.
 */
watch(mobilePopoverOpen, (open) => {
  if (open) {
    void nextTick(() => mobilePopoverBackdropRef.value?.focus())
  }
})

function onPanelClose(): void {
  sidebarCollapsed.value = true
  mobilePopoverOpen.value = false
}

/**
 * Reopen trigger fired by the compact strip. Sets BOTH flags so the
 * strip works as the collapsed-state reopen affordance on every
 * viewport — Tailwind hides whichever surface isn't relevant (the rail
 * has `hidden lg:flex`, the popover has `lg:hidden`), so the unused
 * flag is harmless.
 */
function onStripOpen(): void {
  mobilePopoverOpen.value = true
  sidebarCollapsed.value = false
}

const toast = useToast()

const backDestination = computed(() => {
  if (task.value?.agent_id) {
    return { name: 'agent', params: { id: task.value.agent_id } }
  }
  return { name: 'dashboard' }
})

/**
 * Live sub-agent status summary for the chat header. It follows the parent
 * task's plural child-id list and reads each child's status from the shared
 * sub-task cache; the first awaiting id is used by the header scroll action.
 */
interface SubAgentSummary {
  total: number
  awaitingApproval: number
  running: number
  completed: number
  failed: number
  cancelled: number
  firstAwaitingTaskId: number | null
}

const subAgentSummary = computed<SubAgentSummary | null>(() => {
  const rawIds = currentTask.value?.data?.spawned_sub_task_ids
  if (!Array.isArray(rawIds)) return null
  const ids = rawIds.filter((id): id is number => typeof id === 'number')
  if (ids.length === 0) return null

  let awaitingApproval = 0
  let running = 0
  let completed = 0
  let failed = 0
  let cancelled = 0
  let firstAwaitingTaskId: number | null = null

  for (const id of ids) {
    const status = taskStore.subTaskCache.get(id)?.status
    switch (status) {
      case 'PENDING_APPROVAL':
        awaitingApproval++
        firstAwaitingTaskId ??= id
        break
      case 'RUNNING':
        running++
        break
      case 'COMPLETED':
        completed++
        break
      case 'FAILED':
        failed++
        break
      case 'CANCELLED':
        cancelled++
        break
    }
  }

  return {
    total: ids.length,
    awaitingApproval,
    running,
    completed,
    failed,
    cancelled,
    firstAwaitingTaskId,
  }
})

const subAgentBadgeText = computed(() => {
  const summary = subAgentSummary.value
  if (!summary) return ''

  const parts = [`${summary.total} sub-agent${summary.total === 1 ? '' : 's'}`]
  if (summary.awaitingApproval > 0) parts.push(`${summary.awaitingApproval} needs approval`)
  if (summary.running > 0) parts.push(`${summary.running} running`)
  if (summary.completed > 0) parts.push(`${summary.completed} completed`)
  if (summary.failed > 0) parts.push(`${summary.failed} failed`)
  if (summary.cancelled > 0) parts.push(`${summary.cancelled} cancelled`)
  return parts.join(' · ')
})

function scrollToFirstSubAgent(event: Event): void {
  event.preventDefault()
  const awaitingId = subAgentSummary.value?.firstAwaitingTaskId
  const selector = awaitingId === null || awaitingId === undefined
    ? '[data-testid="sub-agent-tool-call"]'
    : `[data-testid="sub-agent-needs-approval-${awaitingId}"]`
  const target = document.querySelector(selector)
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const messageListRef = ref<InstanceType<typeof TaskChatMessageList> | null>(null)

function scrollToBottom(): void {
  nextTick(() => messageListRef.value?.scrollToBottom())
}

const retry = useTaskChatRetry()
const followup = useTaskChatFollowup()
const approvals = useTaskChatApprovals(taskId, scrollToBottom)

/**
 * Best-effort prefetch of `GET /media/allowed-types` so the follow-up
 * bar's image attach button has a populated `accept` attribute by the
 * time the user clicks it. Failure is silently swallowed — the picker
 * falls back to its default image MIME list (see
 * `useMediaAllowedTypes.DEFAULT_IMAGE_MIME_TYPES`).
 */
onMounted(() => {
  const agentId = currentTask.value?.agent_id
  if (agentId !== undefined) {
    allowedTypes.load(agentId).catch(() => undefined)
  }
})

/**
 * Listen for the `spora:focus-followup` CustomEvent dispatched by the
 * Resume button on the Aborted banner (Plan C). The event model keeps
 * TaskChatBanners ignorant of the composer's internals.
 */
const onFocusFollowup = (): void => {
  void focusFollowup()
}
onMounted(() => {
  document.addEventListener('spora:focus-followup', onFocusFollowup)
})

const chatMessages = computed(() =>
  buildChatMessages(task.value?.history, task.value?.final_response),
)

const expandedTools = ref<Record<number, boolean>>({})
function toggleExpanded(sequence: number): void {
  expandedTools.value[sequence] = !expandedTools.value[sequence]
}

/**
 * Page-owned per-block flag for the CompactToolStream pills. Iteration
 * 4 split the chat into one block per user turn + one block per
 * sub-agent boundary, so each pill tracks its own collapsed state
 * independently — collapsing turn 2's pill leaves turn 1's pill alone.
 * Keyed by `block.id` (the same value the v-for uses on the chat list).
 */
const expandedStreams = ref<Record<number, boolean>>({})
function toggleStream(blockId: number): void {
  expandedStreams.value = {
    ...expandedStreams.value,
    [blockId]: !(expandedStreams.value[blockId] ?? false),
  }
}

// Shared toggle state between the summary (in the header) and the
// details (sibling below). Owned by the page so both components can
// read/write the same boolean via v-model.
const detailsOpen = ref(false)
const detailsRef = ref<InstanceType<typeof TaskUsageDetails> | null>(null)

// scrollIntoView on open so the sticky header doesn't hide the panel's top edge.
watch(detailsOpen, async (open) => {
  if (!open) return
  await nextTick()
  const el = (detailsRef.value?.$el ?? null) as HTMLElement | null
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
})

// Tracks whether we've successfully loaded the task at least once; used to
// avoid bouncing the user back to the dashboard during a transient 404.
let taskLoadSucceeded = false

watch(taskId, async (newId, oldId) => {
  if (!Number.isFinite(newId) || newId === oldId) return
  taskLoadSucceeded = false
  taskStore.stopDetailPolling()
  taskStore.clearActiveTask()
  // Vue Router reuses this component when only the param changes; the
  // child rows cached for the previous parent would otherwise linger
  // and flash under the new task's load. `onUnmounted` clears on leave.
  taskStore.clearSubTaskCache()
  // Drop the chat list's attachment cache so a freshly-navigated task
  // cannot inherit resolved assets from the previous one. Both the
  // module-level cache and the per-component entry-sequence Map must
  // be cleared — the former survives remounts, the latter survives
  // route-param changes within the same component instance.
  clearMediaAssetCache()
  messageListRef.value?.clearEntryAssets()
  const found = await taskStore.fetchTaskDetail(newId)
  if (!found) {
    router.push(backDestination.value)
    return
  }
  taskLoadSucceeded = true
  if (task.value?.agent_id) {
    await agentStore.fetchAgents()
    await agentStore.fetchAgent(task.value.agent_id)
  }
  scrollToBottom()
  if (task.value && !taskStore.isTerminal) {
    taskStore.startDetailPolling(newId)
  }
})

watch(
  () => task.value?.history?.length ?? 0,
  () => scrollToBottom(),
)

watch(task, (newTask) => {
  if (taskLoadSucceeded && newTask === null) {
    router.push(backDestination.value)
  }
})

onMounted(async () => {
  if (Number.isFinite(taskId.value)) {
    taskLoadSucceeded = false
    taskStore.stopDetailPolling()
    taskStore.clearActiveTask()
    const found = await taskStore.fetchTaskDetail(taskId.value)
    if (!found) {
      router.push(backDestination.value)
      return
    }
    taskLoadSucceeded = true
    if (task.value?.agent_id) {
      await agentStore.fetchAgents()
      await agentStore.fetchAgent(task.value.agent_id)
    }
    scrollToBottom()
    if (task.value && !taskStore.isTerminal) {
      taskStore.startDetailPolling(taskId.value)
    }
  }
})

onUnmounted(() => {
  taskStore.stopDetailPolling()
  taskStore.clearSubTaskCache()
  document.removeEventListener('spora:focus-followup', onFocusFollowup)
  // Clear the chat list's attachment cache on task route change AND
  // on unmount, so a freshly-navigated task cannot inherit resolved
  // assets from the previous one. The module-level
  // `useMediaAssetCache` survives component remounts on purpose;
  // without this, a stale entry's resolved `MediaAsset` could be
  // served against a new task's `entry.assets.media_id` if the UUIDs
  // collide (they shouldn't, but defence-in-depth is cheap).
  clearMediaAssetCache()
})

/**
 * Abort affordance state for the `TaskChatAbortButton` rendered inside
 * the chat message list. The button flips its own label to "Aborting…"
 * while `abortSubmitting` is true (immediate click acknowledgement).
 * The chat status itself is NOT flipped until the server confirms —
 * an abort that lands after the loop finished naturally returns 409,
 * and we must not lie to the user about a state change that didn't
 * happen. On success the store patches `activeTask` in place, which
 * lets the ABORTED banner flip visible without waiting on SSE.
 */
const abortSubmitting = ref(false)
async function abortTask(): Promise<void> {
  const active = task.value
  if (!active) return
  abortSubmitting.value = true
  try {
    await taskStore.abortTask(active.id)
    // Wait for the store's list-cache + activeTask patch to land before
    // letting the reactively-bound banner flip visible, so the
    // abort-marker row and follow-up input render together in the next
    // tick.
    await nextTick()
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Abort failed.'
    toast.error(message)
  } finally {
    abortSubmitting.value = false
  }
}

/**
 * Focus the follow-up composer. The auto-focus on ABORTED transition
 * (below) and the explicit Resume button on the Aborted banner both
 * call this — extracted so they share the same code path.
 *
 * The followup composer is rendered as an `md-editor-v3` wrapper
 * whose editable surface is a nested `[contenteditable]` — querying
 * the DOM for it (the previous implementation) coupled this page to
 * library internals and broke the moment `id="task-followup-prompt"`
 * drifted away from the actual composer (the id now lives on the
 * max-steps banner's textarea). Going through the component ref keeps
 * the page agnostic of how the composer is rendered.
 */
const followupBarRef = ref<InstanceType<typeof TaskChatFollowup> | null>(null)
async function focusFollowup(): Promise<void> {
  await nextTick()
  followupBarRef.value?.focus()
}

/**
 * Auto-focus the follow-up composer when the active task transitions
 * to ABORTED. The user just clicked Abort — keeping the next keyboard
 * action in the composer is the right ergonomics.
 */
const previousStatus = ref<string | null>(null)
watch(
  () => task.value?.status ?? null,
  async (newStatus) => {
    if (newStatus === 'ABORTED' && previousStatus.value !== 'ABORTED') {
      await focusFollowup()
    }
    previousStatus.value = newStatus
  },
)

/**
 * Resume-with-default-prompt path for the ABORTED banner. The "Send
 * 'continue'" option in the Resume popover routes here: we drop a
 * default prompt into the composable and reuse its submitFollowup so
 * we share the same error handling, polling restart, and prompt-clear
 * behaviour as a typed send. The composed prompt survives a back-and-
 * forth if the user closed the popover to read the banner first.
 */
async function onResumeSendContinue(): Promise<void> {
  if (!task.value) return
  followup.followupPrompt.value = 'continue'
  await followup.submitFollowup()
}
</script>

<template>
  <AgentLayout :agent-id="currentTask?.agent_id ?? 0">
    <div
      v-if="!currentTask"
      class="flex-1 flex items-center justify-center text-sm text-muted-foreground"
    >
      Loading…
    </div>

    <div
      v-else
      class="flex flex-1 min-h-0"
    >
      <div
        class="flex-1 min-w-0 flex flex-col min-h-0"
        data-testid="chat-column"
      >
        <div class="px-4 py-3 border-b border-border flex items-center gap-3 shrink-0 sticky top-0 z-10 bg-background">
          <button
            @click="router.push(backDestination)"
            class="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted transition-colors"
            aria-label="Back"
            type="button"
          >
            ←
          </button>
          <div class="flex-1 min-w-0">
            <RouterLink
              v-if="currentTask.parent_task_id"
              :to="{ name: 'task', params: { id: String(currentTask.parent_task_id) } }"
              class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>←</span>
              <span>Source task #{{ currentTask.parent_task_id }}</span>
            </RouterLink>
            <h1 class="text-sm font-semibold truncate">
              {{ currentTask.user_prompt }}
            </h1>
            <output
              class="flex items-center gap-2 mt-0.5 flex-wrap"
              aria-live="polite"
              data-testid="task-status-container"
            >
              <TaskStatusBadge :status="currentTask.status" />
              <span class="text-xs text-muted-foreground">Step {{ currentTask.step_count }}</span>
              <a
                v-if="subAgentSummary"
                href="#sub-agent-tool-call"
                class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/60 transition-colors"
                @click="scrollToFirstSubAgent"
              >
                <span>{{ subAgentBadgeText }}</span>
              </a>
            </output>
          </div>
          <div class="shrink-0 min-w-0 max-w-[60%]">
            <TaskUsageSummary
              v-model:details-open="detailsOpen"
              :history="currentTask.history"
              :totals="currentTask.totals ?? null"
            />
          </div>
        </div>

        <TaskUsageDetails
          ref="detailsRef"
          :details-open="detailsOpen"
          :history="currentTask.history"
          :totals="currentTask.totals ?? null"
        />

        <TaskChatMessageList
          ref="messageListRef"
          :task="currentTask"
          :chat-messages="chatMessages"
          :expanded-tools="expandedTools"
          :expanded-streams="expandedStreams"
          :abort-submitting="abortSubmitting"
          @toggle-expanded="toggleExpanded"
          @toggle-stream="toggleStream"
          @abort="abortTask"
        />

        <ToolApprovalBar
          v-if="currentTask.status === 'PENDING_APPROVAL' && pending.length > 0"
          :pending="pending"
          :approve-error="approvals.approveError.value"
          :submitting="approvals.submitting.value"
          :rejecting="approvals.rejecting.value"
          @submit-decisions="approvals.onSubmitDecisions"
          @reject-all="approvals.onRejectAll"
        />

        <TodoCompactStrip
          v-if="hasTodos && composerEnabled && !mobilePopoverOpen"
          :class="sidebarCollapsed ? '' : 'lg:hidden'"
          @open="onStripOpen"
        />

        <AskUserQuestionCard
          v-if="activePendingQuestionBatch"
          :batch="activePendingQuestionBatch"
        />

        <TaskChatBanners
          :task="currentTask"
          :show-retry-banner="retry.showRetryBanner.value"
          :show-non-retryable-error-banner="retry.showNonRetryableErrorBanner.value"
          :non-retryable-error-message="retry.nonRetryableErrorMessage.value ?? null"
          :show-countdown="retry.showCountdown.value"
          :countdown="retry.countdown.value"
          :can-auto-retry="retry.canAutoRetry.value"
          :retries-exhausted="retry.retriesExhausted.value"
          :auto-retry-disabled="retry.autoRetryDisabled.value"
          :retry-attempt="retry.retryAttempt.value"
          :max-retry-attempts="retry.maxRetryAttempts.value"
          :cancelling="retry.cancelling.value"
          @retry-now="retry.retryNow"
          @cancel-retry-chain="retry.cancelRetryChain"
          @dismiss-banner="retry.dismissBanner"
          @resume-send-continue="onResumeSendContinue"
        />

        <TaskChatFollowup
          v-if="composerEnabled"
          ref="followupBarRef"
          :show-followup-bar="followup.showFollowupBar.value"
          :followup-prompt="followup.followupPrompt.value"
          :submitting-followup="followup.submittingFollowup.value"
          :followup-placeholder="followup.followupPlaceholder.value"
          :attached-media="followup.attachedMedia.value"
          :show-media-picker="followup.showMediaPicker.value"
          :picker-media-kind="followup.pickerMediaKind.value"
          :picker-accept="followup.pickerAccept.value"
          :image-support="followup.imageSupport.value"
          :image-button-title="followup.imageButtonTitle.value"
          :composer-error="followup.composerError.value"
          :agent-id="currentTask.agent_id"
          :agent-principal-id="agentStore.currentAgent?.principal_id ?? null"
          @update-followup-prompt="(v: string) => (followup.followupPrompt.value = v)"
          @submit-followup="followup.submitFollowup"
          @update-show-media-picker="(v: boolean) => (followup.showMediaPicker.value = v)"
          @update-picker-media-kind="(v: 'image' | 'image+document') => (followup.pickerMediaKind.value = v)"
          @picker-attach="followup.onPickerAttach"
          @remove-attachment="followup.removeAttachment"
          @request-open-picker="followup.openPicker"
          @audio-recorded="followup.onAudioRecorded"
        />
      </div>

      <div
        v-if="hasTodos && mobilePopoverOpen"
        ref="mobilePopoverBackdropRef"
        tabindex="-1"
        class="lg:hidden fixed inset-0 bg-black/40 z-10 outline-none"
        data-testid="todo-mobile-popover-backdrop"
        @click="onPanelClose"
        @keydown.esc="onPanelClose"
      />

      <TodoProgressPanel
        v-if="hasTodos && mobilePopoverOpen"
        class="lg:hidden fixed inset-x-0 top-20 bottom-0 z-20 rounded-t-xl border border-border bg-background shadow-2xl overflow-hidden"
        data-testid="todo-mobile-popover"
        @close="onPanelClose"
      />

      <TodoProgressPanel
        v-if="hasTodos && !sidebarCollapsed"
        class="hidden lg:flex sticky top-0 self-start h-[calc(100dvh-3.5rem)] w-80 shrink-0 border-l border-border bg-background"
        @close="onPanelClose"
      />
    </div>
  </AgentLayout>
</template>
