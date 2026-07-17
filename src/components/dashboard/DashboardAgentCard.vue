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
  /** Kebab-driven duplicate action. Aggregator wires this to the dialog. */
  duplicate: [agentId: number]
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

type PillKey = 'RUNNING' | 'AWAITING' | 'SCHEDULED' | 'RECENT'

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
  }
}

function pillClass(key: PillKey): string {
  if (key === 'RECENT') return 'pill-recent'
  // RUNNING/AWAITING/SCHEDULED pills always render via StatusBadge so this
  // branch never reaches the template — fall through to an empty class.
  return ''
}

function pillDotClass(key: PillKey): string {
  if (key === 'RECENT') return 'dot-recent'
  return ''
}

const actions = computed<KebabAction[]>(() => [
  { id: 'run', label: 'Run new task', onClick: () => emit('runNewTask', props.agent.id) },
  { id: 'settings', label: 'Settings', onClick: () => emit('settings', props.agent.id) },
  { id: 'duplicate', label: 'Duplicate', onClick: () => emit('duplicate', props.agent.id) },
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

function onChatRowClick(event: MouseEvent): void {
  // Chat rows surface the same action as the card body — the aggregator
  // owns navigation, the card just signals which agent to open. Delegating
  // keeps the two click handlers in lock-step.
  onMoreClick(event)
}
</script>

<template>
  <article
    class="card"
    :data-agent-id="agent.id"
  >
    <div class="card-kebab" @click.stop>
      <KebabMenu :actions="actions" :aria-label="`Actions for ${agent.name}`" />
    </div>
    <button
      type="button"
      class="card-title-link"
      :aria-label="`Open agent ${agent.name}`"
      @click="onCardClick"
    >
      <header class="card-header">
        <Avatar :initials="initials" tone="muted" size="md" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h3 class="card-name">{{ agent.name }}</h3>
            <span v-if="agent.llm_driver_config_id !== null" class="card-llm">llm</span>
          </div>
          <div class="card-states">
            <template v-for="pill in pills" :key="pill.key">
              <StatusBadge
                v-if="pill.status !== null"
                :status="pill.status"
                :pulse="pill.key === 'RUNNING' || pill.key === 'AWAITING'"
              />
              <span
                v-else
                class="state-pill"
                :class="pillClass(pill.key)"
                :data-pill="pill.key"
              >
                <span class="state-pill-dot" :class="pillDotClass(pill.key)" />
                <span>{{ pill.label }} · {{ pill.count }}</span>
              </span>
            </template>
            <span v-if="pills.length === 0" class="empty-hint">
              Idle — no active tasks
            </span>
          </div>
          <p v-if="agent.description" class="card-desc">{{ agent.description }}</p>
        </div>
      </header>
    </button>

    <div v-if="tools.length > 0" class="card-tools">
      <span
        v-for="(tool, idx) in tools.slice(0, 8)"
        :key="`${tool.tool_class}-${idx}`"
        class="tool-tile"
        :title="tool.tool_name"
        :aria-label="`Tool: ${tool.tool_name}`"
      >
        <Icon :name="tool.icon ?? 'puzzle'" class="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </div>

    <div class="card-chats">
      <template v-if="recentTasks.length === 0">
        <p class="chats-empty">No conversations yet</p>
      </template>
      <template v-else>
        <a
          v-for="task in recentTasks"
          :key="task.id"
          :href="`#task-${task.id}`"
          class="chat-row"
          @click.stop="(e: MouseEvent) => onChatRowClick(e)"
        >
          <span class="status-dot" :class="statusDotClass(task.status)" :data-status="task.status" />
          <div class="min-w-0 flex-1">
            <p class="chat-prompt">{{ task.user_prompt || '(empty prompt)' }}</p>
            <div class="chat-meta">
              <span>{{ chatLabel(task.status) }}</span>
              <template v-if="stepLabel(task)">
                <span class="chat-dot">·</span>
                <span>{{ stepLabel(task) }}</span>
              </template>
              <span class="chat-time">{{ relativeTime(task.updated_at) }}</span>
            </div>
          </div>
        </a>
        <a
          v-if="extraCount > 0"
          href="#"
          class="more-link"
          @click.stop="onMoreClick"
        >
          + {{ extraCount }} more
        </a>
      </template>
    </div>

    <footer class="card-footer">
      <div class="card-meta">
        <DashboardScheduledChip :agent-id="agent.id" />
      </div>
      <span class="task-count-pill">{{ taskCount }} tasks</span>
    </footer>
  </article>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  height: 100%;
  padding: 1.25rem;
  border-radius: var(--radius);
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  text-align: left;
  transition: box-shadow 150ms ease, border-color 150ms ease, transform 150ms ease;
  color: inherit;
}

.card:hover {
  border-color: hsl(var(--foreground) / 0.3);
  box-shadow: 0 1px 3px hsl(var(--foreground) / 0.08);
}

.card-title-link {
  display: block;
  width: 100%;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0.375rem;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.card-title-link:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}

.card-header {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.card-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-llm {
  font-size: 0.625rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: hsl(var(--muted-foreground));
  display: none;
}

@media (min-width: 640px) {
  .card-llm {
    display: inline;
  }
}

.card-states {
  margin-top: 0.25rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
}

.card-desc {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-kebab {
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
  z-index: 1;
}

.card-tools {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.tool-tile {
  display: inline-flex;
  width: 1.75rem;
  height: 1.75rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
}

.card-chats {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.chats-empty {
  font-size: 0.75rem;
  font-style: italic;
  color: hsl(var(--muted-foreground));
  margin: 0;
}

.chat-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  border-radius: 0.375rem;
  padding: 0.375rem 0.5rem;
  margin: 0 -0.5rem;
  text-decoration: none;
  color: inherit;
  transition: background-color 150ms ease;
}

.chat-row:hover {
  background: hsl(var(--muted));
}

.status-dot {
  margin-top: 0.375rem;
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  flex-shrink: 0;
  border-radius: 9999px;
}

.chat-prompt {
  font-size: 0.75rem;
  color: hsl(var(--foreground));
  line-height: 1.2;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.chat-meta {
  margin-top: 0.125rem;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.625rem;
  color: hsl(var(--muted-foreground));
}

.chat-time {
  margin-left: auto;
}

.chat-dot {
  opacity: 0.5;
}

.more-link {
  margin-top: 0.25rem;
  display: block;
  font-size: 0.6875rem;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  text-decoration: none;
}

.more-link:hover {
  color: hsl(var(--foreground));
}

.card-footer {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-top: 1px solid hsl(var(--border));
  padding-top: 0.75rem;
}

.card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
}

.task-count-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 0.375rem;
  background: hsl(var(--muted));
  padding: 0.125rem 0.375rem;
  font-size: 0.625rem;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}

.empty-hint {
  font-size: 0.7rem;
  color: hsl(var(--muted-foreground));
  font-style: italic;
}

.state-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 9999px;
  padding: 0.05rem 0.45rem;
  font-size: 0.625rem;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  border: 1px solid;
}

.state-pill-dot {
  display: inline-block;
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 9999px;
}

.pill-recent {
  background: rgb(220 252 231);
  color: rgb(22 101 52);
  border-color: rgb(187 247 208);
}

:global(.dark) .pill-recent {
  background: rgb(20 83 45 / 0.4);
  color: rgb(134 239 172);
  border-color: rgb(22 101 52);
}

.dot-recent {
  background: rgb(34 197 94);
}

:global(.dark) .dot-recent {
  background: rgb(74 222 128);
}
</style>
