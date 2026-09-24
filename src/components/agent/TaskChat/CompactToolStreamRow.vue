<script setup lang="ts">
/**
 * CompactToolStreamRow — one tool-call card inside the expanded chain.
 *
 * Composition mirrors the per-tool card that previously lived inline in
 * TaskChatMessageList.vue:
 *   - header row: icon + tool_name + status dot + status label
 *   - Arguments panel: ToolArgumentsPreview with the effective args
 *     (approved → proposed fallback)
 *   - "Show full input" toggle (new): reveals the raw JSON tree of the
 *     effective arguments, with a copy-to-clipboard button
 *   - Output: truncate + "▼ more" toggle that emits `toggleExpanded` for
 *     the parent to flip the page-level flag
 *   - Handover link: "Handed off — Open chat #N →"
 *
 * Specialised tool-result shapes (Loaded skill badge, TodoToolCall,
 * SubAgentToolCall) are filtered out by the parent before they reach
 * this component — see `genericToolResults` in TaskChatMessageList.vue.
 * The defensive special-case branches inside this row are unreachable
 * in practice; kept as a no-op fallback so the row renders an empty
 * surface rather than throwing if a future caller hands it a row the
 * parent should have filtered.
 */
import { computed, ref } from 'vue'
import type { ToolCall } from '@/types/task'
import type { ChatMessage } from '@/composables/useTaskChat'
import { truncateText, isTruncated } from '@/composables/useTaskChat'
import { renderMarkdown } from '@/composables/useMarkdown'
import Icon from '@/components/ui/Icon.vue'
import ToolArgumentsPreview from '@/components/agent/ToolArgumentsPreview.vue'

interface Props {
  toolCall: ToolCall | null
  toolResult: ChatMessage
  expanded: boolean
  taskId: number
}

const props = defineProps<Props>()

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

function truncate(content: string | null): string {
  return truncateText(content)
}

function isTruncatedContent(): boolean {
  return isTruncated(props.toolResult.entry.content)
}

function formatToolName(name: string): string {
  return name.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
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
</script>

<template>
  <div
    class="rounded-lg border border-border bg-card overflow-hidden"
    data-testid="compact-tool-stream-row"
    data-row-kind="generic"
  >
    <!-- Header row -->
    <div class="flex items-center gap-2 px-3 py-2">
      <Icon
        :name="toolCall?.icon ?? 'puzzle'"
        class="h-3.5 w-3.5 text-muted-foreground shrink-0"
      />
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
    </div>

    <div class="px-3 py-2 border-t border-border space-y-2 chat-bubble-content text-muted-foreground break-all whitespace-pre-wrap">
      <ToolArgumentsPreview
        v-if="effectiveArgsFor(toolCall)"
        class="mb-2"
        :arguments="effectiveArgsFor(toolCall)"
        :tool-name="toolCall?.tool_name ?? undefined"
        :operation="toolCall?.operation ?? undefined"
        :parameter-order="parameterOrderFor(toolCall)"
      />

      <div v-if="fullInputJson">
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

      <template v-if="isTruncatedContent()">
        <div class="flex flex-col gap-2">
          <div v-html="renderMarkdown(expanded ? toolResult.entry.content ?? '' : truncate(toolResult.entry.content))" />
          <button
            type="button"
            class="mt-1 inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-transparent hover:border-border"
            data-testid="more-toggle"
            @click.stop.prevent="emit('toggleExpanded')"
          >
            {{ expanded ? '▲ less' : '▼ more' }}
          </button>
        </div>
      </template>
      <div
        v-else
        v-html="renderMarkdown(truncate(toolResult.entry.content))"
      />

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
  </div>
</template>
