<script setup lang="ts">
/**
 * Renders an executed `handover` call with `op: 'sub_agent'`.
 *
 * The tool result supplies the plural child-id array. Shared cached child
 * details drive the collapsible summary and per-child rows, which show an
 * agent initial, name, id, status, and a link to the child chat. Awaiting
 * rows also expose a button for reviewing approvals.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { ToolCall } from '@/types/task'
import { useTaskStore } from '@/stores/tasks'
import { useAgentStore } from '@/stores/agent'
import { useToast } from '@/composables/useToast'
import Icon from '@/components/ui/Icon.vue'

interface Props {
  toolCall: ToolCall
}

const props = defineProps<Props>()

const router = useRouter()
const taskStore = useTaskStore()
const agentStore = useAgentStore()
const toast = useToast()

const spawnedIds = computed<number[]>(() => {
  const data = props.toolCall.result_data ?? {}
  const ids = data.spawned_sub_task_ids
  if (!Array.isArray(ids)) return []
  return ids.filter((id): id is number => typeof id === 'number')
})

const children = computed(() => {
  const cache = taskStore.subTaskCache
  if (!cache) return []
  return spawnedIds.value.map((id) => cache.get(id) ?? null).filter((c) => c !== null)
})

const statusCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const child of children.value) {
    const status = child.status
    counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
})

const awaitingApprovalCount = computed(() => statusCounts.value['PENDING_APPROVAL'] ?? 0)

const firstAwaitingChildId = computed<number | null>(() => {
  for (const child of children.value) {
    if (child.status === 'PENDING_APPROVAL') {
      return child.id
    }
  }
  return null
})

const summaryText = computed<string | null>(() => {
  if (awaitingApprovalCount.value === 0) return null
  const total = spawnedIds.value.length
  const running = statusCounts.value['RUNNING'] ?? 0
  const queued = statusCounts.value['QUEUED'] ?? 0
  const done = statusCounts.value['COMPLETED'] ?? 0
  const parts: string[] = [`${awaitingApprovalCount.value} needs approval`]
  if (running + queued > 0) parts.push(`${running + queued} running`)
  if (done > 0) parts.push(`${done} done`)
  return `Sub-agents (${total}): ${parts.join(' · ')}`
})

const expanded = ref(true)

const lastLoadedIds = ref<number[]>([])

function spawnedIdsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const id of b) {
    if (!set.has(id)) return false
  }
  return true
}

// Re-load only when the spawned-id set actually changes — the parent's
// poll swaps in an equivalent toolCall object every tick, and the watcher
// would otherwise re-issue identical fetches against the store on every
// poll. `fetchSubTaskDetail` is already a cache-hit no-op, but skipping
// the watcher call avoids the round-trip and keeps the wire quiet.
async function loadChildren(): Promise<void> {
  const ids = spawnedIds.value
  if (spawnedIdsEqual(ids, lastLoadedIds.value)) return
  lastLoadedIds.value = [...ids]
  await Promise.all(ids.map((id) => taskStore.fetchSubTaskDetail(id)))
}

onMounted(() => {
  void loadChildren()
})

watch(spawnedIds, () => {
  void loadChildren()
}, { flush: 'post' })

function childAgentName(childId: number): string {
  const child = children.value.find((c) => c.id === childId)
  if (!child) return '?'
  const agent = agentStore.agents.find((a) => a.id === child.agent_id)
  return agent?.name ?? `Agent #${child.agent_id}`
}

function agentInitial(name: string): string {
  return name.charAt(0).toUpperCase() || '?'
}

interface StatusVisuals {
  label: string
  icon: string
  classes: string
  pulse: boolean
}

function statusVisuals(status: string | undefined): StatusVisuals {
  switch (status) {
    case 'RUNNING':
      return { label: 'Running…', icon: 'loader-2', classes: 'text-blue-600 dark:text-blue-400', pulse: true }
    case 'PENDING_APPROVAL':
      return { label: 'needs approval', icon: 'warning', classes: 'text-amber-700 dark:text-amber-300 font-semibold', pulse: true }
    case 'QUEUED':
      return { label: 'Queued', icon: 'clock', classes: 'text-zinc-600 dark:text-zinc-400', pulse: false }
    case 'COMPLETED':
      return { label: 'Done', icon: 'check-circle', classes: 'text-green-700 dark:text-green-300', pulse: false }
    case 'FAILED':
      return { label: 'Failed', icon: 'error-circle', classes: 'text-red-700 dark:text-red-300', pulse: false }
    case 'CANCELLED':
      return { label: 'Cancelled', icon: 'x', classes: 'text-zinc-500 dark:text-zinc-500', pulse: false }
    default:
      return { label: status ?? 'Unknown', icon: 'clock', classes: 'text-muted-foreground', pulse: false }
  }
}

function isAwaitingApproval(status: string | undefined): boolean {
  return status === 'PENDING_APPROVAL'
}

function openChildApprovals(childId: number, event: Event): void {
  event.preventDefault()
  event.stopPropagation()
  router.push({ name: 'task', params: { id: String(childId) }, hash: '#approvals' })
}

/**
 * Stop Waiting affordance — halts the child sub-agent (the first
 * spawned) and cascades the abort up the parent chain via the
 * backend's `TaskService::abortSubAgentAndCascade`. The parent task
 * lands in `ABORTED` once the cascade finishes; the chat picks up the
 * transition via SSE through `applyTaskUpdate`.
 * Endpoint: `POST /tasks/{id}/abort-sub-agent`.
 */
const stoppingChildren = ref(false)
async function onStopWaiting(event: Event): Promise<void> {
  event.preventDefault()
  event.stopPropagation()
  if (stoppingChildren.value) return
  stoppingChildren.value = true
  try {
    // Abort the child via POST /tasks/{id}/abort-sub-agent.
    // TaskService::abortSubAgentAndCascade walks the parent chain —
    // this chat picks up the parent ABORTED transition via SSE through
    // `applyTaskUpdate`.
    const firstChildId = spawnedIds.value[0]
    if (firstChildId === undefined) return
    await taskStore.abortSubAgent(firstChildId)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Stop failed.'
    toast.error(message)
  } finally {
    stoppingChildren.value = false
  }
}

/**
 * Visible only while the parent task is itself AWAITING_SUB_AGENTS — at
 * that point the parent has no other way to halt the loop. RUNNING means
 * the orchestrator is still in control; terminal states mean the cascade
 * has already finished.
 */
const parentIsAwaiting = computed<boolean>(() => {
  // The widget renders inside the parent's chat; the parent status lives
  // on the active task. Read it from the store rather than the route so
  // we stay accurate during SSE-driven transitions.
  return taskStore.activeTask?.status === 'AWAITING_SUB_AGENTS'
})
</script>

<template>
  <div id="sub-agent-tool-call" class="ml-9 max-w-[85%] text-xs" data-testid="sub-agent-tool-call">
    <div class="rounded-lg border border-border bg-muted/40 overflow-hidden">
      <div class="flex items-center gap-2 px-3 py-2 hover:bg-muted/60 transition-colors">
        <button
          type="button"
          data-testid="sub-agent-toggle"
          :aria-expanded="expanded"
          aria-controls="sub-agent-tool-call-body"
          class="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
          @click="expanded = !expanded"
        >
          <Icon :name="expanded ? 'chevron-down' : 'chevron-right'" class="h-3 w-3 text-muted-foreground shrink-0" />
          <Icon name="agents" class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span class="font-mono font-medium text-muted-foreground">handover</span>
          <span class="font-mono text-amber-700 dark:text-amber-300 text-[11px]">sub_agent</span>
          <span class="text-muted-foreground/60">— sub-agents</span>
        </button>
        <button
          v-if="parentIsAwaiting"
          type="button"
          data-testid="stop-waiting-button"
          class="inline-flex items-center gap-1 rounded-md border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/40 px-1.5 py-0.5 text-[11px] text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
          :disabled="stoppingChildren"
          aria-label="Stop waiting for sub-agents"
          title="Halt parent — children keep running"
          @click.stop="onStopWaiting($event)"
        >
          <Icon name="stop-circle" class="h-3 w-3 shrink-0" />
          <span class="font-medium">Stop waiting</span>
        </button>
      </div>

      <div v-if="awaitingApprovalCount > 0" class="px-3 py-2 border-t border-border bg-amber-50/60 dark:bg-amber-950/20">
        <RouterLink
          :to="{ name: 'task', params: { id: String(firstAwaitingChildId) }, hash: '#approvals' }"
          class="text-amber-800 dark:text-amber-200 hover:text-amber-900 dark:hover:text-amber-100 font-medium"
        >
          {{ summaryText }} →
        </RouterLink>
      </div>

      <div v-if="expanded" id="sub-agent-tool-call-body" class="border-t border-border">
        <div
          v-if="spawnedIds.length === 0"
          class="px-3 py-2 text-muted-foreground flex items-center gap-2"
        >
          <Icon name="loader-2" class="h-3.5 w-3.5 animate-spin" />
          <span>Spawning sub-agent…</span>
        </div>

        <RouterLink
          v-for="child in children"
          :key="child.id"
          :to="{ name: 'task', params: { id: String(child.id) } }"
          class="block px-3 py-2 hover:bg-muted/60 transition-colors border-b border-border last:border-b-0"
          :class="isAwaitingApproval(child.status) ? 'border-l-2 border-amber-500 bg-amber-50/70 dark:bg-amber-950/40' : ''"
          :data-testid="isAwaitingApproval(child.status) ? `sub-agent-needs-approval-${child.id}` : undefined"
        >
          <div class="flex items-center gap-2">
            <div class="shrink-0 h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
              {{ agentInitial(childAgentName(child.id)) }}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="font-medium text-foreground truncate">{{ childAgentName(child.id) }}</span>
                <span class="font-mono text-[10px] text-muted-foreground/70">#{{ child.id }}</span>
              </div>
              <div class="flex items-center gap-1.5 mt-0.5">
                <Icon
                  v-if="isAwaitingApproval(child.status)"
                  name="warning"
                  class="h-3 w-3 text-amber-600 dark:text-amber-400"
                />
                <span :class="statusVisuals(child.status).classes">
                  {{ statusVisuals(child.status).label }}
                </span>
              </div>
            </div>
            <Icon
              v-if="isAwaitingApproval(child.status)"
              name="arrow-right"
              class="h-3.5 w-3.5 text-amber-600 dark:text-amber-400"
            />
          </div>
          <button
            v-if="isAwaitingApproval(child.status)"
            type="button"
            class="mt-2 text-amber-700 dark:text-amber-300 underline underline-offset-2 cursor-pointer"
            @click.stop="openChildApprovals(child.id, $event)"
          >
            Review approvals →
          </button>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
