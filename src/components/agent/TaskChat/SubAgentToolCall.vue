<script setup lang="ts">
/**
 * SubAgentToolCall — renders a `handover(op: 'sub_agent', ...)` tool result.
 *
 * For each spawned child task, shows a row with:
 *   - target agent avatar (or initial fallback)
 *   - bold agent name + id chip
 *   - status indicator (RUNNING / PENDING_APPROVAL / QUEUED / COMPLETED / FAILED / CANCELLED)
 *   - deep link to the child chat
 *
 * PENDING_APPROVAL rows get visual prominence: left-border accent + ⚠ icon
 * + "needs approval" text + an inline "Review approvals →" link to the
 * child chat's approval bar (`/tasks/{id}#approvals`).
 *
 * A collapsed summary line "Sub-agents (N): X needs approval · Y running
 * · Z done" appears above the row list when at least one child is
 * PENDING_APPROVAL — gives the operator a one-glance signal even before
 * they scroll to the relevant tool call.
 *
 * Live updates: the parent task store owns a `subTaskCache` (Map of
 * id → TaskDetail). SSE-driven `applyTaskUpdate` events for child ids
 * present in the cache update the cached entry in place rather than
 * touching the active task — which is what makes the per-row status
 * badges flip live without re-fetching.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { ToolCall } from '@/types/task'
import { useTaskStore } from '@/stores/tasks'
import { useAgentStore } from '@/stores/agent'
import Icon from '@/components/ui/Icon.vue'

interface Props {
  toolCall: ToolCall
}

const props = defineProps<Props>()

const router = useRouter()
const taskStore = useTaskStore()
const agentStore = useAgentStore()

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
    const status = (child as { status?: string }).status ?? 'UNKNOWN'
    counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
})

const awaitingApprovalCount = computed(() => statusCounts.value['PENDING_APPROVAL'] ?? 0)

const firstAwaitingChildId = computed<number | null>(() => {
  for (const child of children.value) {
    if ((child as { status?: string }).status === 'PENDING_APPROVAL') {
      return (child as { id?: number }).id ?? null
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

async function loadChildren(): Promise<void> {
  await Promise.all(spawnedIds.value.map((id) => taskStore.fetchSubTaskDetail(id)))
}

onMounted(() => {
  void loadChildren()
})

watch(spawnedIds, () => {
  void loadChildren()
}, { flush: 'post' })

function childAgentName(childId: number): string {
  const child = children.value.find((c) => (c as { id?: number }).id === childId) as { agent_id?: number; status?: string } | null
  if (!child) return '?'
  const agent = agentStore.agents.find((a) => a.id === child.agent_id)
  return agent?.name ?? `Agent #${child.agent_id ?? '?'}`
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
</script>

<template>
  <div id="sub-agent-tool-call" class="ml-9 max-w-[85%] text-xs" data-testid="sub-agent-tool-call">
    <div class="rounded-lg border border-border bg-muted/40 overflow-hidden">
      <button
        type="button"
        class="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-muted/60 transition-colors"
        @click="expanded = !expanded"
      >
        <Icon :name="expanded ? 'chevron-down' : 'chevron-right'" class="h-3 w-3 text-muted-foreground" />
        <Icon name="agents" class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span class="font-mono font-medium text-muted-foreground">handover</span>
        <span class="font-mono text-amber-700 dark:text-amber-300 text-[11px]">sub_agent</span>
        <span class="text-muted-foreground/60">— sub-agents</span>
      </button>

      <div v-if="summaryText" class="px-3 py-2 border-t border-border bg-amber-50/60 dark:bg-amber-950/20">
        <RouterLink
          v-if="firstAwaitingChildId !== null"
          :to="{ name: 'task', params: { id: String(firstAwaitingChildId) }, hash: '#approvals' }"
          class="text-amber-800 dark:text-amber-200 hover:text-amber-900 dark:hover:text-amber-100 font-medium"
        >
          {{ summaryText }} →
        </RouterLink>
      </div>

      <div v-if="expanded" class="border-t border-border">
        <div
          v-if="spawnedIds.length === 0"
          class="px-3 py-2 text-muted-foreground flex items-center gap-2"
        >
          <Icon name="loader-2" class="h-3.5 w-3.5 animate-spin" />
          <span>Spawning sub-agent…</span>
        </div>

        <RouterLink
          v-for="child in children"
          :key="(child as { id: number }).id"
          :to="{ name: 'task', params: { id: String((child as { id: number }).id) } }"
          class="block px-3 py-2 hover:bg-muted/60 transition-colors border-b border-border last:border-b-0"
          :class="isAwaitingApproval((child as { status?: string }).status) ? 'border-l-2 border-amber-500 bg-amber-50/70 dark:bg-amber-950/40' : ''"
          :data-testid="isAwaitingApproval((child as { status?: string }).status) ? `sub-agent-needs-approval-${(child as { id: number }).id}` : undefined"
        >
          <div class="flex items-center gap-2">
            <div class="shrink-0 h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
              {{ agentInitial(childAgentName((child as { id: number }).id)) }}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="font-medium text-foreground truncate">{{ childAgentName((child as { id: number }).id) }}</span>
                <span class="font-mono text-[10px] text-muted-foreground/70">#{{ (child as { id: number }).id }}</span>
              </div>
              <div class="flex items-center gap-1.5 mt-0.5">
                <Icon
                  v-if="isAwaitingApproval((child as { status?: string }).status)"
                  name="warning"
                  class="h-3 w-3 text-amber-600 dark:text-amber-400"
                />
                <span :class="statusVisuals((child as { status?: string }).status).classes">
                  {{ statusVisuals((child as { status?: string }).status).label }}
                </span>
              </div>
            </div>
            <Icon
              v-if="isAwaitingApproval((child as { status?: string }).status)"
              name="arrow-right"
              class="h-3.5 w-3.5 text-amber-600 dark:text-amber-400"
            />
          </div>
          <button
            v-if="isAwaitingApproval((child as { status?: string }).status)"
            type="button"
            class="mt-2 text-amber-700 dark:text-amber-300 underline underline-offset-2 cursor-pointer"
            @click.stop="openChildApprovals((child as { id: number }).id, $event)"
          >
            Review approvals →
          </button>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
