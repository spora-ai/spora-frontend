<script setup lang="ts">
/**
 * CompactToolStream — collapses a chain of generic tool-result rows into a
 * single pill + expandable chain.
 *
 * Replaces the per-tool <details> card for the generic case (web_search,
 * typst_compile, etc.). Specialised surfaces (SubAgentToolCall, TodoToolCall)
 * keep their own cards and are filtered out by the parent before this
 * component receives them. Loaded-skill rows DO flow through here and
 * render as their own row kind (`data-row-kind="loaded-skill"`).
 *
 * Visual reference: `prototype-a-now-pill.html` in
 * `spora-workspace/prototypes/compact-tool-stream/`.
 *
 * Data flow:
 *   - `task` and `task.tool_calls` supply the ToolCall records (for icon,
 *     status, and human_description).
 *   - `toolResults` is the already-filtered list of `ChatMessage` rows that
 *     this pill represents (order = chat stream order). Each row maps
 *     1:1 to a ToolCall via the `provider_call_id` / DB id lookup in
 *     `toolCallForEntry` from useTaskChat.
 *   - `expandedTools` / `expandedStream` are page-owned and pass through.
 */
import { computed } from 'vue'
import type { TaskDetail, ToolCall, ToolCallStatus } from '@/types/task'
import type { ChatMessage } from '@/composables/useTaskChat'
import { toolCallForEntry, loadedSkillForEntry, type LoadedSkillInfo } from '@/composables/useTaskChat'
import { useTaskStore } from '@/stores/tasks'
import Icon from '@/components/ui/Icon.vue'
import CompactToolStreamRow from '@/components/agent/TaskChat/CompactToolStreamRow.vue'

interface Props {
  task: TaskDetail
  toolResults: ChatMessage[]
  expandedTools: Record<number, boolean>
  expandedStream: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  toggleExpanded: [sequence: number]
  toggleStream: []
}>()

const taskStore = useTaskStore()

const TERMINAL_STATUSES: ReadonlySet<ToolCallStatus> = new Set([
  'EXECUTED',
  'FAILED',
  'REJECTED',
  'DISABLED',
])

/**
 * All ToolCalls that correspond to `toolResults`, in the order the chat
 * stream presents them. Rows that no longer resolve to a live ToolCall
 * (older runs, paginated truncation) are still surfaced with a null
 * toolCall so the chain shows a visible gap rather than silently dropping
 * history — the row component renders the message content either way.
 *
 * Each row also carries a resolved `loadedSkill` so the row component
 * can render the "Loaded skill: <name> — <bytes>" summary variant for
 * `skill_read of SKILL.md` calls.
 */
const rows = computed<Array<{ toolResult: ChatMessage; toolCall: ToolCall | null; loadedSkill: LoadedSkillInfo | null }>>(() => {
  return props.toolResults.map((toolResult) => ({
    toolResult,
    toolCall: toolCallForEntry(props.task, toolResult),
    loadedSkill: loadedSkillForEntry(props.task, toolResult),
  }))
})

/**
 * Most recent in-flight ToolCall — status is NOT terminal AND the task is
 * currently being driven by the worker. When no call is in flight, falls
 * back to the last completed ToolCall so the summary still shows
 * something meaningful after the loop ends.
 */
const currentToolCall = computed<ToolCall | null>(() => {
  const calls = rows.value
    .map((r) => r.toolCall)
    .filter((tc): tc is ToolCall => tc !== null)
  for (let i = calls.length - 1; i >= 0; i--) {
    const tc = calls[i]
    if (tc === undefined) continue
    if (!TERMINAL_STATUSES.has(tc.status)) return tc
  }
  return calls.at(-1) ?? null
})

const isTerminalStatus = computed<boolean>(() => {
  const tc = currentToolCall.value
  return tc !== null && TERMINAL_STATUSES.has(tc.status)
})

/**
 * Indeterminate shimmer / spinning current cell needs a live "in
 * flight" signal. The page already flips `drivingTaskIds` for the
 * duration of each /tick HTTP request, but the task can also be in
 * `RUNNING` without an active tick (Mercure publish landed but no
 * subsequent request is in flight yet). Combine both: client-driven
 * OR a tool that is not yet terminal while the task is RUNNING.
 */
const isInFlight = computed<boolean>(() => {
  const tc = currentToolCall.value
  if (tc === null) return false
  if (isTerminalStatus.value) return false
  return taskStore.isDriving(props.task.id) || props.task.status === 'RUNNING'
})

const FINISHED_STATUSES = new Set(['COMPLETED', 'FAILED', 'ABORTED', 'CANCELLED'])
const isFinished = computed<boolean>(
  () => FINISHED_STATUSES.has(props.task.status) && !taskStore.isDriving(props.task.id),
)

/**
 * "N tools called" — the chat stream count, NOT a "current/max"
 * progress. We count completed + in-flight (only when not already
 * terminal) so the number never decreases as the loop finishes.
 */
const totalCount = computed<number>(() => {
  const completed = props.toolResults.length
  if (isTerminalStatus.value || currentToolCall.value === null) return completed
  return completed + 1
})

function formatToolName(tc: ToolCall | null): string {
  if (tc === null) return 'Tool'
  if (tc.human_description && tc.human_description.length > 0) return tc.human_description
  return tc.tool_name
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
</script>

<template>
  <details
    :open="expandedStream"
    class="lg:ml-9 max-w-[95%] lg:max-w-[85%] rounded-lg border border-border bg-muted/40 overflow-hidden text-xs"
    data-testid="compact-tool-stream"
  >
    <summary
      class="block cursor-pointer select-none list-none hover:bg-muted/60 transition-colors"
      @click.prevent="emit('toggleStream')"
    >
      <div class="flex items-center gap-3 px-3 py-2.5">
        <span
          class="current-cell"
          :class="{ spin: isInFlight }"
          data-testid="compact-tool-stream-current"
        >
          <Icon
            v-if="!isFinished || isInFlight"
            :name="currentToolCall?.icon ?? 'puzzle'"
            class="h-3 w-3"
          />
          <Icon
            v-else
            name="check"
            class="h-3 w-3"
          />
        </span>
        <span
          class="text-[13px] font-medium font-mono text-foreground truncate flex-1 min-w-0"
          data-testid="compact-tool-stream-current-name"
        >
          {{ isFinished && !isInFlight ? 'Done' : formatToolName(currentToolCall) }}
        </span>
        <span
          class="text-[11px] text-muted-foreground font-mono tabular-nums shrink-0"
          data-testid="compact-tool-stream-count"
        >
          {{ totalCount }} tool{{ totalCount === 1 ? '' : 's' }} called
        </span>
        <Icon
          name="chevron-right"
          class="h-3.5 w-3.5 text-muted-foreground shrink-0 chev"
        />
      </div>
      <div
        class="shimmer"
        :class="{ idle: !isInFlight }"
        data-testid="compact-tool-stream-shimmer"
      >
        <div class="sheen" />
      </div>
    </summary>

    <div class="chain-wrap">
      <div class="chain-inner">
        <div class="border-t border-border p-3 space-y-2 bg-background">
          <CompactToolStreamRow
            v-for="row in rows"
            :key="row.toolResult.entry.sequence"
            :tool-call="row.toolCall"
            :tool-result="row.toolResult"
            :loaded-skill="row.loadedSkill"
            :expanded="expandedTools[row.toolResult.entry.sequence] === true"
            :task-id="task.id"
            @toggle-expanded="emit('toggleExpanded', row.toolResult.entry.sequence)"
          />
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
/* Indeterminate shimmer — full-width gradient sweep. When the task is
 * idle (not driving, terminal) the strip dims and the sheen stops. */
.shimmer {
  position: relative;
  overflow: hidden;
  background: hsl(var(--muted));
  height: 2px;
}
.sheen {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    hsl(var(--primary) / 0.5) 50%,
    transparent 100%
  );
  transform: translateX(-100%);
  animation: progress 1.6s linear infinite;
}
.shimmer.idle .sheen {
  animation: none;
  opacity: 0;
}
.shimmer.idle {
  background: hsl(var(--border));
}

/* 22px current-tool icon tile — same shape as the prototype (gradient
 * bg, spinning icon when in flight, static icon when idle). */
.current-cell {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: linear-gradient(
    135deg,
    hsl(var(--primary)) 0%,
    hsl(var(--primary) / 0.7) 100%
  );
  color: hsl(var(--primary-foreground));
  flex-shrink: 0;
}
.current-cell :deep(svg) {
  width: 13px;
  height: 13px;
}
.current-cell.spin :deep(svg) {
  animation: icon-spin 1.4s linear infinite;
}

/* Chain reveal — animate grid-template-rows 0fr → 1fr for the smooth
 * slide. The inner overflow:hidden carries the visual clipping so the
 * children don't bleed out during the transition. */
.chain-wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 320ms cubic-bezier(0.4, 0, 0.2, 1);
}
.chain-wrap > .chain-inner {
  overflow: hidden;
}
details[open] .chain-wrap {
  grid-template-rows: 1fr;
}

/* Chevron rotation on open — matches the prototype's summary behaviour
 * without relying on `group-open:` (which only works for elements that
 * are direct children of a `<details>` parent). */
.chev {
  transition: transform 220ms ease;
  transform: rotate(0deg);
}
details[open] .chev {
  transform: rotate(90deg);
}

/* Strip the native disclosure marker — we provide our own chevron. */
summary::-webkit-details-marker {
  display: none;
}
summary {
  list-style: none;
}
</style>
