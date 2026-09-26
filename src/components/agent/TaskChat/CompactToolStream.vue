<script setup lang="ts">
/**
 * CompactToolStream — collapses a chain of generic tool-result rows into a
 * single pill + expandable chain.
 *
 * Replaces the per-tool <details> card for the generic case (web_search,
 * typst_compile, etc.). SubAgentToolCall keeps its own card and is
 * filtered out of `messages` before this component builds its row list.
 * Successful todo writes render as their own row kind
 * (`data-row-kind="todo"`) inside the pill — collapsed by default like
 * the generic rows, but with a dedicated "plan updated" treatment and a
 * markdown-rendered checklist body. Failed / non-write todo calls fall
 * through to the generic `data-row-kind="generic"` row so the operator
 * sees the error in context. Loaded-skill rows DO flow through here and
 * render as their own row kind (`data-row-kind="loaded-skill"`);
 * reasoning rows (`data-row-kind="reasoning"`) are interleaved with
 * tool rows in chat order so the operator sees a single chronological
 * chain.
 *
 * `messages` is THIS BLOCK's chat stream only — the parent splits the
 * full list into one block per user turn + one block per sub-agent
 * boundary before passing it in.
 */
import { computed } from 'vue'
import type { TaskDetail, ToolCall, ToolCallStatus } from '@/types/task'
import type { ChatMessage, LoadedSkillInfo } from '@/composables/useTaskChat'
import {
  toolCallForEntry,
  loadedSkillForEntry,
  reasoningForChatMessage,
  isSubAgentToolResult,
  isTodoWriteToolResult,
} from '@/composables/useTaskChat'
import { useTaskStore } from '@/stores/tasks'
import Icon from '@/components/ui/Icon.vue'
import CompactToolStreamRow from '@/components/agent/TaskChat/CompactToolStreamRow.vue'

interface Props {
  task: TaskDetail
  /** Messages for THIS block only (already filtered by the parent). */
  messages: ChatMessage[]
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

type RowKind = 'tool' | 'reasoning' | 'todo'

interface StreamRow {
  kind: RowKind
  sequence: number
  toolResult: ChatMessage | null
  toolCall: ToolCall | null
  loadedSkill: LoadedSkillInfo | null
  reasoningText: string | null
}

const rows = computed<StreamRow[]>(() => {
  const out: StreamRow[] = []
  for (const msg of props.messages) {
    if (msg.kind === 'tool-result') {
      if (isSubAgentToolResult(props.task, msg)) continue
      const tc = toolCallForEntry(props.task, msg)
      if (tc !== null && isTodoWriteToolResult(props.task, msg)) {
        out.push({
          kind: 'todo',
          sequence: msg.entry.sequence,
          toolResult: msg,
          toolCall: tc,
          loadedSkill: null,
          reasoningText: null,
        })
        continue
      }
      out.push({
        kind: 'tool',
        sequence: msg.entry.sequence,
        toolResult: msg,
        toolCall: tc,
        loadedSkill: loadedSkillForEntry(props.task, msg),
        reasoningText: null,
      })
    } else if (msg.kind === 'assistant') {
      const text = reasoningForChatMessage(msg)
      if (text === null) continue
      out.push({
        kind: 'reasoning',
        sequence: msg.entry.sequence,
        toolResult: null,
        toolCall: null,
        loadedSkill: null,
        reasoningText: text,
      })
    }
  }
  return out
})

const toolRows = computed<StreamRow[]>(() => rows.value.filter((r) => r.kind === 'tool' || r.kind === 'todo'))
const reasoningRows = computed<StreamRow[]>(() => rows.value.filter((r) => r.kind === 'reasoning'))

// Falls back to the last completed ToolCall when no call is in flight, so
// the summary still shows something meaningful after the loop ends.
const currentToolCall = computed<ToolCall | null>(() => {
  const calls = toolRows.value
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

// Combine client-driven (drivingTaskIds, the active-tick signal) with the
// task's own RUNNING status — Mercure can publish RUNNING without a
// subsequent /tick in flight, and we still want the spinner on.
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

// Count completed + in-flight (only when not already terminal) so the
// number never decreases as the loop finishes.
const totalTools = computed<number>(() => {
  const completed = toolRows.value.length
  if (isTerminalStatus.value || currentToolCall.value === null) return completed
  return completed + 1
})

const totalReasoning = computed<number>(() => reasoningRows.value.length)

const summaryText = computed<string>(() => {
  const tools = totalTools.value
  const reasoning = totalReasoning.value
  if (tools > 0 && reasoning > 0) {
    return `${tools} tool${tools === 1 ? '' : 's'} called · ${reasoning} reasoning step${reasoning === 1 ? '' : 's'}`
  }
  if (tools > 0) {
    return `${tools} tool${tools === 1 ? '' : 's'} called`
  }
  if (reasoning > 0) {
    return `${reasoning} reasoning step${reasoning === 1 ? '' : 's'}`
  }
  return ''
})

// When the pill has only reasoning rows, fall through to "Reasoning" with a
// brain glyph so the summary still reads as an activity indicator.
const summaryTitle = computed<string>(() => {
  if (currentToolCall.value !== null) {
    return isFinished.value && !isInFlight.value ? 'Done' : formatToolName(currentToolCall.value)
  }
  if (totalReasoning.value > 0) return 'Reasoning'
  return ''
})

const summaryIcon = computed<string>(() => {
  if (currentToolCall.value !== null && (!isFinished.value || isInFlight.value)) {
    return currentToolCall.value.icon ?? 'puzzle'
  }
  if (totalReasoning.value > 0) return 'brain'
  return 'check'
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
            :name="summaryIcon"
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
          {{ summaryTitle }}
        </span>
        <span
          class="text-[11px] text-muted-foreground font-mono tabular-nums shrink-0"
          data-testid="compact-tool-stream-count"
        >
          {{ summaryText }}
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
            :key="`${row.sequence}-${row.kind}`"
            :kind="row.kind"
            :tool-call="row.toolCall"
            :tool-result="row.toolResult"
            :loaded-skill="row.loadedSkill"
            :reasoning-text="row.reasoningText"
            :expanded="expandedTools[row.sequence] === true"
            :task-id="task.id"
            @toggle-expanded="emit('toggleExpanded', row.sequence)"
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

/* 22px current-tool icon tile (gradient bg, spinning icon when in
 * flight, static when idle). */
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
  animation: pulse-dot 1.6s ease-in-out infinite;
}

/* Chain reveal — animate `grid-template-rows` 0fr → 1fr for the smooth
 * slide. The inner `overflow:hidden` carries the visual clipping. */
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

/* Chevron rotation on open — `group-open:` would not work here
 * because the `.chev` element is a grandchild of `<details>`. */
.chev {
  transition: transform 220ms ease;
  transform: rotate(0deg);
}
details[open] .chev {
  transform: rotate(90deg);
}

summary::-webkit-details-marker {
  display: none;
}
summary {
  list-style: none;
}
</style>