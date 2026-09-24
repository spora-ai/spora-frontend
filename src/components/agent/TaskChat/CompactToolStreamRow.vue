<script setup lang="ts">
/**
 * CompactToolStreamRow — one row inside the expanded CompactToolStream
 * chain. Two row kinds:
 *
 *   - `kind: 'tool'` — one tool-result entry. Composition mirrors the
 *     per-tool card that previously lived inline in
 *     TaskChatMessageList.vue:
 *       - header summary (icon + tool_name + status dot + status label)
 *       - Arguments panel: ToolArgumentsPreview with the effective args
 *         (approved → proposed fallback)
 *       - "Show full input" toggle: reveals the raw JSON tree of the
 *         effective arguments, with a copy-to-clipboard button
 *       - Output: full text (no truncation — collapse is row-level,
 *         not output-level)
 *       - Handover link: "Handed off — Open chat #N →"
 *
 *   - `kind: 'reasoning'` — one assistant message's joined thinking
 *     text. Header summary shows a brain glyph + "Reasoning"; the body
 *     is the reasoning text rendered as Markdown. No status dot, no
 *     arguments panel, no handover link — reasoning has no inputs or
 *     outputs, only display text.
 *
 * Row-level collapse is implemented as a native <details> with the
 * header as <summary>. The summary's click is `.prevent`ed and emits
 * `toggleExpanded` so the page flips the parent-owned flag; that flag
 * flows back as `:open`, keeping the visible state in sync.
 *
 * Specialised tool-result shapes (TodoToolCall, SubAgentToolCall) are
 * filtered out by the parent before they reach this component. Loaded
 * skill rows DO reach this component and render a compact summary
 * (skipping the Arguments panel — skill reads are a side-effect of the
 * agent's tool call, not an action the operator took).
 */
import { computed, ref } from 'vue'
import type { ToolCall } from '@/types/task'
import type { ChatMessage, LoadedSkillInfo } from '@/composables/useTaskChat'
import { renderMarkdown } from '@/composables/useMarkdown'
import Icon from '@/components/ui/Icon.vue'
import ToolArgumentsPreview from '@/components/agent/ToolArgumentsPreview.vue'

interface Props {
  /** `'tool'` for tool-result rows, `'reasoning'` for assistant thinking. */
  kind?: 'tool' | 'reasoning'
  toolCall?: ToolCall | null
  toolResult?: ChatMessage | null
  /** Resolved loaded-skill metadata; renders the loaded-skill variant when non-null. */
  loadedSkill?: LoadedSkillInfo | null
  /** Joined thinking text, only populated when `kind === 'reasoning'`. */
  reasoningText?: string | null
  expanded: boolean
  taskId: number
}

const props = withDefaults(defineProps<Props>(), {
  kind: 'tool',
  toolCall: null,
  toolResult: null,
  loadedSkill: null,
  reasoningText: null,
})

const emit = defineEmits<{
  toggleExpanded: []
}>()

const showFullInput = ref(false)
const copyState = ref<'idle' | 'copied'>('idle')

interface StatusVisuals {
  dotClass: string
  label: string
}

function statusVisuals(tc: ToolCall | null): StatusVisuals {
  // Three colours cover the chat timeline: green (ok), amber (awaiting
  // human/operator), red (error), grey (cancelled/rejected/disabled).
  // The label is a short verb form; UX prefers this over the raw enum.
  switch (tc?.status) {
    case 'EXECUTED':
      return { dotClass: 'bg-emerald-500', label: 'ok' }
    case 'PENDING_APPROVAL':
      return { dotClass: 'bg-amber-500', label: 'awaiting approval' }
    case 'FAILED':
      return { dotClass: 'bg-red-500', label: 'failed' }
    case 'APPROVED':
      return { dotClass: 'bg-blue-500', label: 'approved' }
    case 'PENDING':
      return { dotClass: 'bg-blue-500', label: 'pending' }
    case 'REJECTED':
      return { dotClass: 'bg-zinc-400', label: 'rejected' }
    case 'DISABLED':
      return { dotClass: 'bg-zinc-400', label: 'disabled' }
    default:
      return { dotClass: 'bg-zinc-400', label: tc?.status ?? 'unknown' }
  }
}

function effectiveArgsFor(tc: ToolCall | null): Record<string, unknown> | null {
  if (!tc) return null
  const approved = tc.approved_arguments
  if (approved !== null && approved !== undefined && Object.keys(approved).length > 0) {
    return approved
  }
  const proposed = tc.proposed_arguments
  if (proposed !== null && proposed !== undefined && Object.keys(proposed).length > 0) {
    return proposed
  }
  return null
}

function parameterOrderFor(tc: ToolCall | null): string[] {
  if (!tc?.parameter_schema?.properties) return []
  return Object.keys(tc.parameter_schema.properties)
}

/**
 * Resolve the data payload attached to this row. The backend stores the
 * structured result on the matching ToolCall (`result_data`); the chat
 * row itself only carries the textual `result_content`.
 */
function resultDataForEntry(): Record<string, unknown> | null {
  const data = props.toolCall?.result_data
  if (data === null || data === undefined) return null
  return data
}

const isReasoning = computed<boolean>(() => props.kind === 'reasoning')
const isToolRow = computed<boolean>(() => props.kind === 'tool')

function toolResultLinkTarget(): number | string | null {
  const data = resultDataForEntry()
  if (!data) return null
  const raw = data.new_task_id ?? data.task_id
  if (raw == null) return null
  return typeof raw === 'number' ? raw : String(raw)
}

function toolResultIsHandover(): boolean {
  return resultDataForEntry()?.handover === true
}

function formatToolName(name: string): string {
  return name.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Human-readable byte count for the loaded-skill header summary.
 */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`
  return `${Math.round(n / (102.4 * 102.4)) / 10} MB`
}

const fullInputJson = computed<string>(() => {
  const args = effectiveArgsFor(props.toolCall)
  if (args === null) return ''
  return JSON.stringify(args, null, 2)
})

async function copyFullInput(): Promise<void> {
  const text = fullInputJson.value
  if (!text) return
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
    }
    copyState.value = 'copied'
  } catch {
    // Clipboard may be blocked; the button state never flips to "copied"
    // so the user knows the copy didn't take.
  }
}

/**
 * Native <details> doesn't react to click on <summary> when the row's
 * own toggle handler runs — we always `.prevent` the click and emit so
 * the page flips the parent-owned flag (which then re-renders `:open`).
 * Mirrors the same dance the outer pill does in CompactToolStream.vue.
 */
function onSummaryClick(event: MouseEvent): void {
  event.preventDefault()
  emit('toggleExpanded')
}
</script>

<template>
  <details
    :open="expanded"
    class="rounded-lg border border-border bg-card overflow-hidden"
    data-testid="compact-tool-stream-row"
    :data-row-kind="isReasoning ? 'reasoning' : (loadedSkill ? 'loaded-skill' : 'generic')"
  >
    <!-- Header summary — click to expand/collapse the row body. -->
    <summary
      class="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-muted/60 transition-colors list-none"
      data-testid="compact-tool-stream-row-summary"
      @click="onSummaryClick"
    >
      <Icon
        v-if="isReasoning"
        name="brain"
        class="h-3.5 w-3.5 text-muted-foreground shrink-0"
      />
      <Icon
        v-else
        name="puzzle"
        class="h-3.5 w-3.5 text-muted-foreground shrink-0"
      />
      <template v-if="isReasoning">
        <span class="font-mono font-medium text-muted-foreground">Reasoning</span>
        <span class="flex-1" />
      </template>
      <template v-else-if="loadedSkill">
        <span class="font-mono font-medium text-muted-foreground">Loaded skill:</span>
        <span class="font-mono text-foreground truncate min-w-0 flex-1">{{ loadedSkill.name }}</span>
        <span
          v-if="loadedSkill.bytes > 0"
          class="text-muted-foreground/60 shrink-0"
        >
          — {{ formatBytes(loadedSkill.bytes) }}
        </span>
      </template>
      <template v-else>
        <span class="font-mono font-medium text-muted-foreground truncate min-w-0 flex-1">
          {{ toolCall?.human_description ?? formatToolName(toolCall?.tool_name ?? 'tool') }}
        </span>
        <span
          :class="statusVisuals(toolCall).dotClass"
          class="inline-block h-1.5 w-1.5 rounded-full shrink-0"
          :aria-label="statusVisuals(toolCall).label"
        />
        <span class="text-[11px] text-muted-foreground/70 shrink-0">
          {{ statusVisuals(toolCall).label }}
        </span>
      </template>
      <Icon
        name="chevron-right"
        class="row-chevron h-3.5 w-3.5 text-muted-foreground shrink-0"
      />
    </summary>

    <!-- Reasoning body — collapsed-by-default markdown rendering. -->
    <div
      v-if="isReasoning"
      class="px-3 py-2 border-t border-border chat-bubble-content text-muted-foreground break-words whitespace-pre-wrap"
      data-testid="compact-tool-stream-row-reasoning-body"
      v-html="renderMarkdown(reasoningText ?? '')"
    />

    <!-- Tool row body — hidden when collapsed, full when open. -->
    <div
      v-else-if="isToolRow && toolResult"
      class="px-3 py-2 border-t border-border space-y-2 chat-bubble-content text-muted-foreground break-all whitespace-pre-wrap"
    >
      <ToolArgumentsPreview
        v-if="!loadedSkill && effectiveArgsFor(toolCall)"
        class="mb-2"
        :arguments="effectiveArgsFor(toolCall)"
        :tool-name="toolCall?.tool_name ?? undefined"
        :operation="toolCall?.operation ?? undefined"
        :parameter-order="parameterOrderFor(toolCall)"
      />

      <div v-if="!loadedSkill && fullInputJson">
        <button
          type="button"
          class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          data-testid="show-full-input-toggle"
          @click="showFullInput = !showFullInput"
        >
          <Icon
            :name="showFullInput ? 'chevron-down' : 'chevron-right'"
            class="h-3 w-3"
          />
          {{ showFullInput ? 'Hide full input' : 'Show full input' }}
        </button>
        <div
          v-if="showFullInput"
          class="mt-1.5 relative rounded-md border border-border bg-muted/20 overflow-hidden"
        >
          <button
            type="button"
            class="absolute right-2 top-2 text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2 py-0.5 rounded bg-background/80"
            @click="copyFullInput"
          >
            <Icon
              :name="copyState === 'copied' ? 'check' : 'paperclip'"
              class="h-3 w-3"
            />
            {{ copyState === 'copied' ? 'Copied' : 'Copy' }}
          </button>
          <pre class="px-3 py-2 text-[11px] font-mono overflow-x-auto max-h-72"><code>{{ fullInputJson }}</code></pre>
        </div>
      </div>

      <div v-html="renderMarkdown(toolResult.entry.content ?? '')" />

      <RouterLink
        v-if="toolResultLinkTarget() !== null"
        :to="{ name: 'task', params: { id: String(toolResultLinkTarget()) } }"
        class="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
        data-testid="compact-tool-stream-handover-link"
      >
        <template v-if="toolResultIsHandover()">
          Handed off —
        </template>
        Open chat #{{ toolResultLinkTarget() }} →
      </RouterLink>
    </div>
  </details>
</template>

<style scoped>
/* Strip the native disclosure marker — we provide our own chevron. */
summary::-webkit-details-marker {
  display: none;
}
summary {
  list-style: none;
}

/* Chevron rotation on open — matches the prototype's summary behaviour
 * without relying on `group-open:` (which only works for elements that
 * are direct children of a `<details>` parent). */
.row-chevron {
  transition: transform 220ms ease;
  transform: rotate(0deg);
}
details[open] .row-chevron {
  transform: rotate(90deg);
}
</style>