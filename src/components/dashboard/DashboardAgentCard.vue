<script setup lang="ts">
/**
 * DashboardAgentCard — the new dashboard's primary surface for an agent.
 *
 * Mirrors the prototype's `tpl-card` block: an avatar + name + LLM header,
 * a multi-state pill row, a line-clamped description, a tools row, the
 * three most recent chat rows (task status dot, prompt, step counter,
 * relative time), a footer with kebab + task-count pill, and an optional
 * scheduled-run chip.
 *
 * The card root is `<article>` so we can nest the kebab (a `<button>`) and
 * each chat row (an `<a>`) as siblings without invalid HTML. Only the
 * title area wraps a real `<button class="card-title-link">` that emits
 * `select`. Inner controls stop propagation so the parent's navigation
 * only fires on the title-button click.
 *
 * State (KPI counts, active states by agent, etc.) is read from
 * `useDashboardData()` so the aggregator and the cards share a single
 * source of truth.
 */
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useDashboardData } from '@/composables/useDashboardData'
import type { Agent, AgentTool } from '@/types/agent'
import type { Task, TaskStatus } from '@/types/task'
import Avatar from '@/components/ui/Avatar.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import KebabMenu, { type KebabAction } from '@/components/ui/KebabMenu.vue'
import DashboardScheduledChip from '@/components/dashboard/DashboardScheduledChip.vue'
import OwnerBadge from '@/components/agent/OwnerBadge.vue'

interface Props {
  /** Agent rendered by this card. */
  agent: Agent
}

interface Emits {
  /** Fired when the card background is clicked. Inner controls stop propagation. */
  select: [agentId: number]
  /** Kebab-driven run-new-task action. Aggregator wires this to navigation. */
  runNewTask: [agentId: number]
  /** Kebab-driven settings action. Aggregator wires this to navigation. */
  settings: [agentId: number]
  /** Kebab-driven favorite toggle. */
  favorite: [agentId: number]
  /** Kebab-driven archive toggle. */
  archive: [agentId: number]
/** Kebab-driven destructive delete. Aggregator wires this to the confirm dialog. */
  delete: [agentId: number]
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { tasks, activeStatesByAgent } = useDashboardData()

/** Tasks that belong to this agent, sorted newest-first by `updated_at`. */
const agentTasks = computed<Task[]>(() => {
  return tasks.value
    .filter((t) => t.agent_id === props.agent.id)
    .slice()
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
})

/** Up to three most-recent tasks shown in the chats section. */
const recentTasks = computed<Task[]>(() => agentTasks.value.slice(0, 3))

/** Subset of active states for the multi-state pill row. */
const activeStates = computed<Set<TaskStatus>>(
  () => activeStatesByAgent.value.get(props.agent.id) ?? new Set<TaskStatus>(),
)

type PillKey = 'RUNNING' | 'AWAITING' | 'SCHEDULED' | 'RECENT' | 'ABORTED'

interface PillDescriptor {
  key: PillKey
  label: string
  count: number
  status: TaskStatus | null
}

/**
 * Synthetic pill states the prototype renders (RUNNING / AWAITING / SCHEDULED
 * / RECENT). RECENT is rendered as a custom pill because StatusBadge has no
 * "recent" variant — the other three reuse StatusBadge with the matching
 * `TaskStatus`.
 */
const pills = computed<PillDescriptor[]>(() => {
  const states = activeStates.value
  const out: PillDescriptor[] = []
  if (states.has('RUNNING')) {
    out.push({
      key: 'RUNNING',
      label: 'Running',
      count: countByStatus('RUNNING'),
      status: 'RUNNING',
    })
  }
  if (states.has('PENDING_APPROVAL')) {
    out.push({
      key: 'AWAITING',
      label: 'Awaiting',
      count: countByStatus('PENDING_APPROVAL'),
      status: 'PENDING_APPROVAL',
    })
  }
  // ABORTED surfaces a fourth synthetic pill: tasks the user halted
  // mid-flight. Operators comparing agent states across a dashboard will
  // want to know which agents have a held conversation that needs a
  // follow-up prompt.
  if (states.has('ABORTED')) {
    out.push({
      key: 'ABORTED',
      label: 'Aborted',
      count: countByStatus('ABORTED'),
      status: 'ABORTED',
    })
  }
  if (states.has('PENDING')) {
    out.push({
      key: 'SCHEDULED',
      label: 'Scheduled',
      count: countByStatus('PENDING'),
      status: 'PENDING',
    })
  }
  if (
    states.size === 0
    && recentTasks.value.some((t) => t.status === 'COMPLETED')
  ) {
    out.push({
      key: 'RECENT',
      label: 'Recently',
      count: countByStatus('COMPLETED'),
      status: null,
    })
  }
  return out
})

function countByStatus(status: TaskStatus): number {
  let n = 0
  for (const t of agentTasks.value) if (t.status === status) n++
  return n
}

const taskCount = computed<number>(() => agentTasks.value.length)

const extraCount = computed<number>(() => Math.max(0, agentTasks.value.length - 3))

const initials = computed<string>(() => {
  const words = props.agent.name.split(/\s+/).filter((w) => w.length > 0)
  if (words.length === 0) return '?'
  const chars = words.slice(0, 2).map((w) => w[0] ?? '')
  return chars.join('').toUpperCase()
})

const tools = computed<AgentTool[]>(() => props.agent.tools)

function statusDotClass(status: TaskStatus): string {
  switch (status) {
    case 'RUNNING': return 'bg-blue-500'
    case 'PENDING_APPROVAL': return 'bg-amber-500'
    case 'COMPLETED': return 'bg-green-500'
    case 'FAILED': return 'bg-red-500'
    case 'CANCELLED': return 'bg-zinc-400'
    case 'PENDING': return 'bg-violet-500'
    case 'AWAITING_SUB_AGENTS': return 'bg-violet-500'
    case 'AWAITING_INPUT': return 'bg-sky-500'
    case 'ABORTED': return 'bg-stone-400'
  }
}

function pillClass(key: PillKey): string {
  if (key === 'RECENT') return 'pill-recent border bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800'
  // RUNNING/AWAITING/SCHEDULED pills always render via StatusBadge so this
  // branch never reaches the template — fall through to an empty class.
  return ''
}

function pillDotClass(key: PillKey): string {
  if (key === 'RECENT') return 'dot-recent bg-green-500 dark:bg-green-400'
  return ''
}

const actions = computed<KebabAction[]>(() => [
  { id: 'run', label: 'Run new task', onClick: () => emit('runNewTask', props.agent.id) },
  { id: 'settings', label: 'Settings', onClick: () => emit('settings', props.agent.id) },
  { id: 'favorite', label: props.agent.is_favorite ? 'Remove favorite' : 'Add to favorites', onClick: () => emit('favorite', props.agent.id) },
  { id: 'archive', label: props.agent.is_archived ? 'Unarchive' : 'Archive', onClick: () => emit('archive', props.agent.id) },
  { id: 'delete', label: 'Delete', danger: true, onClick: () => emit('delete', props.agent.id) },
])

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.round((now - then) / 1000)
  if (Number.isNaN(diffSec)) return ''
  const abs = Math.abs(diffSec)
  if (abs < 60) return diffSec >= 0 ? 'just now' : 'in a moment'
  const minutes = Math.round(diffSec / 60)
  if (Math.abs(minutes) < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) return `${days}d ago`
  const weeks = Math.round(days / 7)
  if (Math.abs(weeks) < 5) return `${weeks}w ago`
  const months = Math.round(days / 30)
  if (Math.abs(months) < 12) return `${months}mo ago`
  const years = Math.round(days / 365)
  return `${years}y ago`
}

function chatLabel(status: TaskStatus): string {
  switch (status) {
    case 'RUNNING': return 'Running'
    case 'PENDING_APPROVAL': return 'Awaiting'
    case 'COMPLETED': return 'Completed'
    case 'FAILED': return 'Failed'
    case 'CANCELLED': return 'Cancelled'
    case 'PENDING': return 'Pending'
    case 'AWAITING_SUB_AGENTS': return 'Awaiting Sub-agents'
    case 'AWAITING_INPUT': return 'Awaiting Input'
    case 'ABORTED': return 'Aborted'
  }
}

function stepLabel(task: Task): string | null {
  if (typeof task.step_count !== 'number') return null
  if (task.max_steps !== null) return `step ${task.step_count}/${task.max_steps}`
  return `step ${task.step_count}`
}

function onCardClick(event: MouseEvent): void {
  // The card root is `<article>` and only the title-area is a real
  // `<button>`. We still guard against programmatic clicks whose target is
  // a child interactive element (kebab trigger, chat row, "+ N more"
  // link) — these stop propagation themselves, but the guard catches
  // synthetic clicks whose event target is a descendant.
  if (event.target instanceof Element) {
    if (event.target.closest('.card-kebab')) return
    if (event.target.closest('.chat-row')) return
    if (event.target.closest('.more-link')) return
    if (event.target.closest('[role="menuitem"]')) return
  }
  emit('select', props.agent.id)
}

function onMoreClick(event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
  emit('select', props.agent.id)
}

</script>
<template>
  <article
    class="card relative flex h-full flex-col gap-3 rounded-[var(--radius)] border border-border bg-background p-5 text-left text-inherit transition-[box-shadow,border-color,transform] duration-150 hover:border-foreground/30 hover:shadow-[0_1px_3px_rgb(0_0_0/0.08)]"
    :data-agent-id="agent.id"
  >
    <div class="card-kebab absolute right-3 top-3 z-10">
      <KebabMenu
        :actions="actions"
        :aria-label="`Actions for ${agent.name}`"
      />
    </div>
    <button
      type="button"
      class="card-title-link block w-full cursor-pointer rounded-md border-0 bg-transparent p-0 text-left font-inherit text-inherit focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      :aria-label="`Open agent ${agent.name}`"
      @click="onCardClick"
    >
      <header class="card-header flex items-start gap-3">
        <Avatar
          :initials="initials"
          :profile-picture="agent.profile_picture ?? null"
          tone="muted"
          size="md"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="card-name m-0 truncate text-sm font-semibold text-foreground">
              {{ agent.name }}
            </h3>
            <span
              v-if="agent.llm_driver_config_id !== null"
              class="card-llm hidden font-mono text-[0.625rem] uppercase tracking-wider text-muted-foreground sm:inline"
            >llm</span>
            <OwnerBadge :agent="agent" />
          </div>
          <div class="card-states mt-1 flex flex-wrap items-center gap-1">
            <template
              v-for="pill in pills"
              :key="pill.key"
            >
              <StatusBadge
                v-if="pill.status !== null"
                :status="pill.status"
                :pulse="pill.key === 'RUNNING' || pill.key === 'AWAITING'"
              />
              <span
                v-else
                :class="['state-pill', 'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[0.625rem] font-semibold leading-[1.3]', pillClass(pill.key)]"
                :data-pill="pill.key"
              >
                <span
                  :class="['state-pill-dot', 'inline-block h-1.5 w-1.5 rounded-full', pillDotClass(pill.key)]"
                />
                <span>{{ pill.label }} · {{ pill.count }}</span>
              </span>
            </template>
            <span
              v-if="pills.length === 0"
              class="empty-hint text-[0.7rem] italic text-muted-foreground"
            >
              Idle — no active tasks
            </span>
          </div>
          <p
            v-if="agent.description"
            class="card-desc mt-1 line-clamp-2 text-xs leading-[1.3] text-muted-foreground"
          >
            {{ agent.description }}
          </p>
        </div>
      </header>
    </button>

    <div
      v-if="tools.length > 0"
      class="card-tools flex items-center gap-1.5"
    >
      <span
        v-for="(tool, idx) in tools.slice(0, 8)"
        :key="`${tool.tool_class}-${idx}`"
        class="tool-tile inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground"
        :title="tool.tool_name"
        :aria-label="`Tool: ${tool.tool_name}`"
      >
        <Icon
          :name="tool.icon ?? 'puzzle'"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        />
      </span>
    </div>

    <div class="card-chats flex flex-col gap-1.5">
      <template v-if="recentTasks.length === 0">
        <p class="chats-empty m-0 text-xs italic text-muted-foreground">
          No conversations yet
        </p>
      </template>
      <template v-else>
        <router-link
          v-for="task in recentTasks"
          :key="task.id"
          :to="{ name: 'task', params: { id: String(task.id) } }"
          class="chat-row -mx-2 flex items-start gap-2 rounded-md px-2 py-1.5 text-inherit no-underline transition-colors hover:bg-muted"
        >
          <span
            class="status-dot mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
            :class="statusDotClass(task.status)"
            :data-status="task.status"
          />
          <div class="min-w-0 flex-1">
            <p class="chat-prompt line-clamp-1 m-0 text-xs leading-[1.2] text-foreground">
              {{ task.user_prompt || '(empty prompt)' }}
            </p>
            <div class="chat-meta mt-0.5 flex items-center gap-1.5 text-[0.625rem] text-muted-foreground">
              <span>{{ chatLabel(task.status) }}</span>
              <template v-if="stepLabel(task)">
                <span class="chat-dot opacity-50">·</span>
                <span>{{ stepLabel(task) }}</span>
              </template>
              <span class="chat-time ml-auto">{{ relativeTime(task.updated_at) }}</span>
            </div>
          </div>
        </router-link>
        <a
          v-if="extraCount > 0"
          href="#"
          class="more-link mt-1 block text-[0.6875rem] font-medium text-muted-foreground no-underline hover:text-foreground"
          @click.stop="onMoreClick"
        >
          + {{ extraCount }} more
        </a>
      </template>
    </div>

    <footer class="card-footer mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
      <div class="card-meta flex flex-wrap items-center gap-1.5">
        <DashboardScheduledChip :agent-id="agent.id" />
      </div>
      <span class="task-count-pill inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[0.625rem] font-medium text-muted-foreground">{{ taskCount }} tasks</span>
    </footer>
  </article>
</template>
