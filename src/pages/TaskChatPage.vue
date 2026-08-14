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
import { useToast } from '@/composables/useToast'
import { buildChatMessages, findFinalReasoning } from '@/composables/useTaskChat'
import type { TaskDetail } from '@/types/task'
import AgentLayout from '@/components/layout/AgentLayout.vue'
import TaskStatusBadge from '@/components/TaskStatusBadge.vue'
import ToolApprovalBar from '@/components/agent/ToolApprovalBar.vue'
import TaskChatBanners from '@/components/agent/TaskChat/TaskChatBanners.vue'
import TaskChatMessageList from '@/components/agent/TaskChat/TaskChatMessageList.vue'
import TaskChatFollowup from '@/components/agent/TaskChat/TaskChatFollowup.vue'
import TaskUsageSummary from '@/components/TaskUsageSummary.vue'
import TaskUsageDetails from '@/components/TaskUsageDetails.vue'

const route = useRoute()
const router = useRouter()
const taskStore = useTaskStore()
const agentStore = useAgentStore()

const taskId = computed(() => Number(route.params.id))
const task = computed(() => taskStore.activeTask)
const currentTask = computed(() => task.value as TaskDetail | null)
const pending = computed(() => taskStore.pendingToolCalls)
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

const chatMessages = computed(() =>
  buildChatMessages(task.value?.history, task.value?.final_response),
)

const finalReasoning = computed(() =>
  findFinalReasoning(task.value?.history, task.value?.final_response),
)

const expandedTools = ref<Record<number, boolean>>({})
function toggleExpanded(sequence: number): void {
  expandedTools.value[sequence] = !expandedTools.value[sequence]
}

// Shared toggle state between the summary (in the header) and the
// details (sibling below). Owned by the page so both components can
// read/write the same boolean via v-model.
const detailsOpen = ref(false)

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
 * Auto-focus the follow-up composer when the active task transitions
 * to ABORTED. The user just clicked Abort — keeping the next keyboard
 * action in the composer is the right ergonomics.
 */
const previousStatus = ref<string | null>(null)
watch(
  () => task.value?.status ?? null,
  async (newStatus) => {
    if (newStatus === 'ABORTED' && previousStatus.value !== 'ABORTED') {
      await nextTick()
      const ta = document.querySelector<HTMLTextAreaElement>(
        '#task-followup-prompt, [data-testid="followup-input"]',
      )
      ta?.focus()
    }
    previousStatus.value = newStatus
  },
)
</script>

<template>
  <AgentLayout :agent-id="currentTask?.agent_id ?? 0">
    <div v-if="!currentTask" class="flex-1 flex items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>

    <div v-else class="flex-1 flex flex-col">

      <div class="px-4 py-3 border-b border-border flex items-center gap-3 shrink-0">
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
          <h1 class="text-sm font-semibold truncate">{{ currentTask.user_prompt }}</h1>
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
        :details-open="detailsOpen"
        :history="currentTask.history"
        :totals="currentTask.totals ?? null"
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
        :show-max-steps-banner="retry.showMaxStepsBanner.value"
        :followup-prompt="followup.followupPrompt.value"
        :submitting-followup="followup.submittingFollowup.value"
        @retry-now="retry.retryNow"
        @cancel-retry-chain="retry.cancelRetryChain"
        @dismiss-banner="retry.dismissBanner"
        @update-followup-prompt="(v: string) => (followup.followupPrompt.value = v)"
        @submit-followup="followup.submitFollowup"
      />

      <TaskChatMessageList
        ref="messageListRef"
        :task="currentTask"
        :chat-messages="chatMessages"
        :final-reasoning="finalReasoning"
        :expanded-tools="expandedTools"
        :abort-submitting="abortSubmitting"
        @toggle-expanded="toggleExpanded"
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

      <TaskChatFollowup
        :show-followup-bar="followup.showFollowupBar.value"
        :followup-prompt="followup.followupPrompt.value"
        :submitting-followup="followup.submittingFollowup.value"
        :followup-error="followup.followupError.value"
        :followup-placeholder="followup.followupPlaceholder.value"
        @update-followup-prompt="(v: string) => (followup.followupPrompt.value = v)"
        @submit-followup="followup.submitFollowup"
      />
    </div>
  </AgentLayout>
</template>
