<script setup lang="ts">
/**
 * CompactToolStream — collapses a chain of tool-result rows into one
 * pill + expandable chain. SubAgentToolCall rows are filtered out by
 * the parent; successful todo writes render as their own row kind.
 * `messages` is THIS BLOCK's chat stream only.
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
import { Icon } from '@spora-ai/components/icons'
import CompactToolStreamRow from '@/components/agent/TaskChat/CompactToolStreamRow.vue'

interface Props {
  task: TaskDetail
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

/* Current-tool icon tile — spinning while in flight, static when idle. */
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

/* Animate grid-template-rows 0fr → 1fr for the smooth chain reveal. The
 * inner overflow:hidden carries the visual clipping. */
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

/* `group-open:` would not work here — the .chev element is a
 * grandchild of <details>, so we target the open attribute directly. */
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