<script setup lang="ts">
/**
 * TaskChatMessageList — the scrollable chat history.
 *
 * Renders the user/assistant/tool bubbles, the final-response pill, the
 * failed banner, the running indicator, and a scroll anchor. The page owns
 * the scroll lifecycle and calls `scrollToBottom` after fetches + on new
 * history entries.
 */
import { computed, ref, watch } from 'vue'
import type { TaskDetail, HistoryEntry, ToolCall } from '@/types/task'
import type { ChatMessage } from '@/composables/useTaskChat'
import { truncateText, isTruncated } from '@/composables/useTaskChat'
import { renderMarkdown } from '@/composables/useMarkdown'
import Icon from '@/components/ui/Icon.vue'
import TaskFailedBanner from '@/components/agent/TaskFailedBanner.vue'
import TaskChatAbortButton from '@/components/agent/TaskChat/TaskChatAbortButton.vue'
import ToolArgumentsPreview from '@/components/agent/ToolArgumentsPreview.vue'
import SubAgentToolCall from '@/components/agent/TaskChat/SubAgentToolCall.vue'
import { useTaskStore } from '@/stores/tasks'
import { useMediaAssetCache } from '@/composables/useMediaAssetCache'
import type { MediaAsset } from '@/types/media'

interface Props {
  task: TaskDetail
  chatMessages: ChatMessage[]
  finalReasoning: string | null
  /** Per-sequence expanded flag; owned by the page so it survives remounts. */
  expandedTools?: Record<number, boolean>
  /** Disable the abort button while the request is in flight. */
  abortSubmitting?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  expandedTools: () => ({}),
  abortSubmitting: false,
})

const emit = defineEmits<{
  toggleExpanded: [sequence: number]
  abort: []
}>()

const bottomEl = ref<HTMLDivElement | null>(null)

function scrollToBottom(): void {
  bottomEl.value?.scrollIntoView({ behavior: 'smooth' })
}

/**
 * Formatter for the abort-marker divider label. Renders the wall-clock
 * timestamp in the user's local timezone — the marker row is written by
 * the backend as a UTC ISO-8601 string, and the user's clock is the right
 * viewer. Falls back to the raw string when the date is unparseable
 * (an old or malformed row should never break the chat).
 */
function formatAbortMarkerAt(iso: string): string {
  const formatted = new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
  return formatted === 'Invalid Date' ? iso : formatted
}

function truncate(content: string | null): string {
  return truncateText(content)
}

/**
 * "Step 3 of 5" subtitle for the working indicator. Surfaces progress
 * so the user can see the agent loop is actually advancing — the
 * bouncing dots alone look the same at step 1 and step 99. Hidden when
 * `max_steps` isn't known yet (a freshly-QUEUED task that's never been
 * polled) — better to show just the dots + label than a misleading
 * "Step 0 of 0".
 */
const stepProgressLabel = computed(() => {
  const stepCount = props.task.step_count ?? 0
  const maxSteps = props.task.max_steps ?? null
  if (typeof maxSteps !== 'number' || maxSteps <= 0) return null
  return `Step ${stepCount} of ${maxSteps}`
})

/**
 * The in-flight spinner needs to render for the duration of every
 * `/tick` HTTP request, not just when the server's `status` is
 * `RUNNING` — the typical shared-host deployment has no Mercure, so
 * the wire never publishes `RUNNING`. The `taskStore.drivingTaskIds`
 * Set is flipped by the SharedWorker's `tick-start` message and
 * cleared on `tick-result`, so it tracks the in-flight window
 * exactly. For server-mode installs (or any path that reaches
 * `RUNNING` on the wire) the `status === 'RUNNING'` check is still
 * authoritative — `driving` is the client-worker gap filler.
 */
const taskStore = useTaskStore()
const showRunningIndicator = computed(
  () => !props.abortSubmitting
    && (taskStore.isDriving(props.task.id) || props.task.status === 'RUNNING'),
)

// History rows carry the LLM-side id (provider_call_id); the DB id is
// indexed alongside as a fallback for older runs.
const toolResultDataByHistoryCallId = computed(() => {
  const map = new Map<string, Record<string, unknown>>()
  for (const tc of props.task.tool_calls ?? []) {
    if (tc.result_data) {
      map.set(tc.provider_call_id, tc.result_data)
      map.set(String(tc.id), tc.result_data)
    }
  }
  return map
})

function resultDataForEntry(entry: ChatMessage): Record<string, unknown> | null {
  if (entry.kind !== 'tool-result') return null
  const callId = entry.entry.tool_call_id
  if (!callId) return null
  return toolResultDataByHistoryCallId.value.get(callId) ?? null
}

/**
 * Look up the ToolCall that produced this history entry, by matching
 * either the provider-side id (which the LLM tool-calling payload uses)
 * or the DB-side id (used as a fallback if the provider id was not
 * recorded). Returns null when the tool call is no longer in the
 * task's `tool_calls` list (older runs, paginated truncation, etc.).
 */
function toolCallForEntry(entry: ChatMessage): ToolCall | null {
  if (entry.kind !== 'tool-result') return null
  const callId = entry.entry.tool_call_id
  if (!callId) return null
  for (const tc of props.task.tool_calls ?? []) {
    if (tc.provider_call_id === callId || String(tc.id) === callId) {
      return tc
    }
  }
  return null
}

/**
 * Detect "skill_read of SKILL.md" — the only tool call that the chat
 * transcript should render as a "Loaded skill" badge instead of the
 * standard tool-call card (see spora-workspace/plans/skills.md §8 for
 * the rendering decision).
 */
interface LoadedSkillInfo {
  name: string
  bytes: number
}

function loadedSkillForEntry(entry: ChatMessage): LoadedSkillInfo | null {
  if (entry.kind !== 'tool-result') return null
  if (entry.entry.tool_name !== 'skill') return null
  const tc = toolCallForEntry(entry)
  if (!tc) return null
  // Failed or rejected skill_read calls fall back to the standard tool-call
  // card (see spora-workspace/plans/skills.md §8). Without this guard a
  // path-traversal block or an oversize-file error would still render as a
  // "Loaded skill: <slug>" badge with 0 bytes.
  if (tc.status === 'FAILED' || tc.status === 'REJECTED') return null
  const args = (tc.approved_arguments ?? tc.proposed_arguments) as Record<string, unknown> | null
  if (!args) return null
  if (args.action !== 'read') return null
  // `filename` is optional and defaults to SKILL.md; treat absent as a
  // match. Any other filename falls through to the standard card.
  if (args.filename !== undefined && args.filename !== null && args.filename !== '' && args.filename !== 'SKILL.md') {
    return null
  }
  const data = resultDataForEntry(entry)
  const name = (typeof data?.name === 'string' ? data.name : null)
    ?? (typeof args.name === 'string' ? args.name : null)
    ?? '?'
  const bytes = typeof data?.bytes === 'number' ? data.bytes : 0
  return { name, bytes }
}

// Memoize the per-message badge lookup — the template's v-if + bindings
// would otherwise re-walk props.task.tool_calls on every render.
const loadedSkillBySequence = computed<Map<number, LoadedSkillInfo | null>>(() => {
  const map = new Map<number, LoadedSkillInfo | null>()
  for (const msg of props.chatMessages) {
    if (msg.kind !== 'tool-result') continue
    map.set(msg.entry.sequence, loadedSkillForEntry(msg))
  }
  return map
})

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`
  return `${Math.round(n / (102.4 * 102.4)) / 10} MB`
}

function toolResultLinkTarget(entry: ChatMessage): number | string | null {
  const data = resultDataForEntry(entry)
  if (!data) return null
  const raw = data.new_task_id ?? data.task_id
  if (raw == null) return null
  return typeof raw === 'number' ? raw : String(raw)
}

function toolResultIsHandover(entry: ChatMessage): boolean {
  const data = resultDataForEntry(entry)
  return data?.handover === true
}

/**
 * Source-task breadcrumb written by `HandoverService::handover` on the
 * closed source task's `data.handover`. Used to deep-link the
 * "Handed off to …" final-response pill to the target agent.
 *
 * The backend writes the keys in snake_case (per the `data` JSON column
 * convention used elsewhere on `Task.data`); we normalise to camelCase
 * here so the rest of the component deals in a single shape.
 */
interface HandoverBreadcrumb {
  targetAgentId: number
  targetAgentName: string
}

const handoverBreadcrumb = computed<HandoverBreadcrumb | null>(() => {
  const data = props.task.data as { handover?: Record<string, unknown> } | null | undefined
  const handoff = data?.handover
  const agentId = handoff?.target_agent_id
  if (!handoff || typeof agentId !== 'number') return null
  const name = handoff.target_agent_name
  return {
    targetAgentId:  agentId,
    targetAgentName: typeof name === 'string' && name !== ''
      ? name
      : `Agent #${agentId}`,
  }
})

/**
 * The `sub_agent` op on HandoverTool is delegated to a dedicated
 * SubAgentToolCall component for live multi-child status rendering.
 * The legacy `handover` op continues to render the standard
 * "Handed off — Open chat #N →" link.
 */
function toolResultIsSubAgent(entry: ChatMessage): boolean {
  const data = resultDataForEntry(entry)
  return data?.op === 'sub_agent'
}

/**
 * Effective arguments shown to the operator: `approved_arguments` when the
 * tool was approved (preserved on `tool_calls.approved_arguments`), falling
 * back to `proposed_arguments`. The chat never shows a proposed-vs-approved
 * diff — operators audit through the approval bar shown at submit time.
 */
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

/**
 * Render the preview in the same field order the tool author declared via
 * #[ToolParameter], sourced from `ToolCall.parameter_schema.properties` keys.
 */
function parameterOrderFor(tc: ToolCall | null): string[] {
  if (!tc?.parameter_schema?.properties) return []
  return Object.keys(tc.parameter_schema.properties)
}

/**
 * Resolve which reasoning text to render for an assistant message.
 *
 * Order of precedence:
 *
 * 1. First `thinking` block from `content_blocks` (the post-PR source
 *    of truth — Anthropic extended thinking and any future Responses-API
 *    driver that surfaces structured reasoning).
 * 2. `null` — no foldout is rendered.
 *
 * The `redacted_thinking` block type intentionally does NOT supply
 * displayable reasoning text, so rows containing only redacted thinking
 * do not render a per-message foldout.
 */
function reasoningForEntry(entry: HistoryEntry): string | null {
  if (entry.role !== 'assistant') return null
  const thinking = entry.content_blocks?.find(
    (b) => b.type === 'thinking' && b.text,
  )
  if (thinking?.text) return thinking.text
  return null
}

defineExpose({ scrollToBottom })

/**
 * Module-level media-asset cache + batch resolver. Resolves every
 * `entry.attachments[*].media_id` referenced from the chat history
 * into `MediaAsset` payloads the bubble can render without N+1.
 */
const mediaCache = useMediaAssetCache()

/**
 * Per-entry attachment chip state. Resolves attachment refs in a
 * single batched call (cached for the session) and exposes a
 * synchronous accessor so the template can render each chip without
 * awaiting per-row resolution.
 */
const entryAssets = ref<Map<number, Map<string, MediaAsset>>>(new Map())

async function resolveEntryAssets(entry: HistoryEntry): Promise<void> {
  const attachments = entry.attachments ?? []
  const cached = entryAssets.value.get(entry.sequence)
  const missing = attachments
    .map((att) => att.media_id)
    .filter((id) => cached === undefined || !cached.has(id))
  if (missing.length === 0 && cached !== undefined) {
    return
  }
  const resolved = await mediaCache.batchResolve(attachments.map((att) => att.media_id))
  const next = new Map(cached ?? new Map())
  for (const [id, asset] of resolved) {
    next.set(id, asset)
  }
  entryAssets.value.set(entry.sequence, next)
}

function assetForEntry(entry: HistoryEntry, mediaId: string): MediaAsset | null {
  return entryAssets.value.get(entry.sequence)?.get(mediaId) ?? null
}

function assetUrlForEntry(entry: HistoryEntry, mediaId: string): string | null {
  return assetForEntry(entry, mediaId)?.asset_url ?? null
}

function filenameForEntry(entry: HistoryEntry, mediaId: string): string | null {
  return assetForEntry(entry, mediaId)?.filename ?? null
}

function isImageAttachment(att: { media_id: string; kind: 'image' | 'text' }): boolean {
  return att.kind === 'image'
}

/**
 * Watch the chat messages list for newly-appeared attachment refs and
 * batch-resolve them. The watcher is intentionally non-immediate so we
 * don't re-resolve the entire history on every render.
 */
watch(
  () => props.chatMessages,
  async (messages) => {
    const pending = messages
      .map((msg) => msg.entry)
      .filter((entry) => Array.isArray(entry.attachments) && (entry.attachments?.length ?? 0) > 0)
    for (const entry of pending) {
      await resolveEntryAssets(entry)
    }
  },
  { flush: 'post' },
)
</script>

<template>
  <div class="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-3" data-testid="chat-message-list">

    <template v-for="msg in chatMessages" :key="msg.entry.sequence">

      <div v-if="msg.kind === 'user'" class="flex justify-end">
        <div class="max-w-[75%] flex flex-col items-end gap-1.5">
          <div
            v-if="msg.entry.attachments && msg.entry.attachments.length > 0"
            class="flex flex-wrap gap-1.5 justify-end"
            data-testid="user-message-attachments"
          >
            <a
              v-for="att in msg.entry.attachments"
              :key="att.media_id"
              :href="assetUrlForEntry(msg.entry, att.media_id) ?? '#'"
              target="_blank"
              rel="noopener noreferrer"
              :title="filenameForEntry(msg.entry, att.media_id) ?? att.media_id"
              class="inline-flex items-center gap-1.5 rounded-full bg-primary/80 hover:bg-primary/70 pl-1 pr-2 py-0.5 text-xs text-primary-foreground transition-colors max-w-[200px]"
              data-testid="user-message-attachment"
            >
              <img
                v-if="isImageAttachment(att) && assetUrlForEntry(msg.entry, att.media_id)"
                :src="assetUrlForEntry(msg.entry, att.media_id) ?? ''"
                :alt="filenameForEntry(msg.entry, att.media_id) ?? att.media_id"
                class="h-5 w-5 rounded-full object-cover bg-primary-foreground/20"
              />
              <Icon v-else name="file" class="h-3.5 w-3.5" />
              <span class="truncate">{{ filenameForEntry(msg.entry, att.media_id) ?? att.media_id.slice(0, 8) }}</span>
            </a>
          </div>
          <div class="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground whitespace-pre-wrap break-words">
            {{ msg.entry.content }}
          </div>
        </div>
      </div>

      <template v-if="msg.kind === 'assistant'">
        <div v-if="reasoningForEntry(msg.entry)" class="flex justify-start -mb-1.5">
          <div class="ml-9 mt-1 text-xs text-muted-foreground w-full max-w-[85%]">
            <details class="group">
              <summary class="inline-flex items-center gap-1.5 px-1.5 py-0.5 cursor-pointer select-none list-none text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                <Icon name="chevron-right" class="h-3 w-3 transition-transform group-open:rotate-90" />
                Reasoning
              </summary>
              <div class="mt-1.5 px-3 py-2 rounded-lg border border-border bg-muted/10 chat-bubble-content !text-[11px]" v-html="renderMarkdown(reasoningForEntry(msg.entry) ?? '')" />
            </details>
          </div>
        </div>

        <div v-if="msg.entry.content" class="flex justify-start">
          <div class="flex gap-2.5 max-w-[85%]">
            <div class="shrink-0 h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground mt-0.5">
              AI
            </div>
            <div class="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5 text-sm">
              <div class="chat-bubble-content" v-html="renderMarkdown(msg.entry.content ?? '')" />
            </div>
          </div>
        </div>
      </template>

      <div v-if="msg.kind === 'tool-result'" class="flex justify-start">
        <SubAgentToolCall
          v-if="toolResultIsSubAgent(msg) && toolCallForEntry(msg)"
          :tool-call="toolCallForEntry(msg)!"
        />
        <details v-else-if="loadedSkillBySequence.get(msg.entry.sequence)" class="ml-9 max-w-[85%] text-xs rounded-lg border border-border bg-muted/40 overflow-hidden">
          <summary class="flex items-center gap-2 px-3 py-2 cursor-pointer select-none list-none hover:bg-muted/60 transition-colors">
            <Icon name="puzzle" class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span class="font-mono font-medium text-muted-foreground">Loaded skill:</span>
            <span class="font-mono text-foreground">{{ loadedSkillBySequence.get(msg.entry.sequence)?.name }}</span>
            <span v-if="(loadedSkillBySequence.get(msg.entry.sequence)?.bytes ?? 0) > 0" class="text-muted-foreground/60">
              — {{ formatBytes(loadedSkillBySequence.get(msg.entry.sequence)?.bytes ?? 0) }}
            </span>
          </summary>
          <div class="px-3 py-2 border-t border-border chat-bubble-content text-muted-foreground break-all whitespace-pre-wrap">
            <template v-if="isTruncated(msg.entry.content)">
              <div class="flex flex-col gap-2">
                <div v-html="renderMarkdown(props.expandedTools[msg.entry.sequence] ? msg.entry.content ?? '' : truncate(msg.entry.content))" />
                <button
                  @click.stop.prevent="emit('toggleExpanded', msg.entry.sequence)"
                  class="mt-1 inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-transparent hover:border-border"
                  type="button"
                >
                  {{ props.expandedTools[msg.entry.sequence] ? '▲ less' : '▼ more' }}
                </button>
              </div>
            </template>
            <div v-else v-html="renderMarkdown(truncate(msg.entry.content))" />
          </div>
        </details>
        <details v-else class="ml-9 max-w-[85%] text-xs rounded-lg border border-border bg-muted/40 overflow-hidden">
          <summary class="flex items-center gap-2 px-3 py-2 cursor-pointer select-none list-none hover:bg-muted/60 transition-colors">
            <Icon name="file" class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span class="font-mono font-medium text-muted-foreground">{{ msg.entry.tool_name }}</span>
            <span class="text-muted-foreground/60">— result</span>
          </summary>
          <div class="px-3 py-2 border-t border-border chat-bubble-content text-muted-foreground break-all whitespace-pre-wrap">
            <ToolArgumentsPreview
              v-if="effectiveArgsFor(toolCallForEntry(msg))"
              class="mb-2"
              :arguments="effectiveArgsFor(toolCallForEntry(msg))"
              :tool-name="msg.entry.tool_name ?? undefined"
              :operation="toolCallForEntry(msg)?.operation ?? undefined"
              :parameter-order="parameterOrderFor(toolCallForEntry(msg))"
            />
            <template v-if="isTruncated(msg.entry.content)">
              <div class="flex flex-col gap-2">
                <div v-html="renderMarkdown(props.expandedTools[msg.entry.sequence] ? msg.entry.content ?? '' : truncate(msg.entry.content))" />
                <button
                  @click.stop.prevent="emit('toggleExpanded', msg.entry.sequence)"
                  class="mt-1 inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-transparent hover:border-border"
                  type="button"
                >
                  {{ props.expandedTools[msg.entry.sequence] ? '▲ less' : '▼ more' }}
                </button>
              </div>
            </template>
            <div v-else v-html="renderMarkdown(truncate(msg.entry.content))" />
            <RouterLink
              v-if="toolResultLinkTarget(msg) !== null"
              :to="{ name: 'task', params: { id: String(toolResultLinkTarget(msg)) } }"
              class="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              <template v-if="toolResultIsHandover(msg)">Handed off — </template>
              Open chat #{{ toolResultLinkTarget(msg) }} →
            </RouterLink>
          </div>
        </details>
      </div>

      <div v-else-if="msg.kind === 'system-marker'" class="flex justify-center my-1" data-testid="abort-marker">
        <div class="inline-flex items-center gap-2 px-3 py-0.5 text-[11px] text-stone-500 dark:text-stone-400">
          <span class="h-px w-8 bg-stone-300 dark:bg-stone-700" aria-hidden="true" />
          <Icon name="x-circle" class="h-3 w-3 shrink-0" />
          <span class="font-medium tracking-wide uppercase">Aborted at {{ formatAbortMarkerAt(msg.marker.at) }}</span>
          <span class="h-px w-8 bg-stone-300 dark:bg-stone-700" aria-hidden="true" />
        </div>
      </div>

    </template>

    <div v-if="finalReasoning" class="flex justify-start -mb-1.5">
      <div class="ml-9 mt-1 text-xs text-muted-foreground w-full max-w-[85%]">
        <details class="group">
          <summary class="inline-flex items-center gap-1.5 px-1.5 py-0.5 cursor-pointer select-none list-none text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors">
            <Icon name="chevron-right" class="h-3 w-3 transition-transform group-open:rotate-90" />
            Reasoning
          </summary>
          <div class="mt-1.5 px-3 py-2 rounded-lg border border-border bg-muted/10 chat-bubble-content !text-[11px]" v-html="renderMarkdown(finalReasoning)" />
        </details>
      </div>
    </div>

    <!--
      The abort-in-flight indicator MUST render independently of
      `task.status` because Mercure publishes the ABORTED status
      through SSE before the HTTP response reaches the client, and the
      detail-poller also queues status flips asynchronously. Wrapping
      the spinner inside the same v-if as the bouncing dots would let
      SSE win the race and hide the spinner the moment the user clicks
      Abort — which is exactly the "feels broken" symptom we are
      fixing. The spinner is driven by `abortSubmitting` alone, so it
      stays visible for the entire request window no matter what
      happens to `task.status` underneath.
    -->
    <div
      v-if="abortSubmitting"
      class="flex justify-start"
      data-testid="aborting-indicator"
    >
      <div class="ml-9 px-3 py-2">
        <output
          class="flex items-center gap-2 text-[11px] text-muted-foreground"
          aria-live="polite"
          aria-label="Aborting agent loop"
        >
          <Icon name="loader-2" class="h-3 w-3 animate-spin" />
          <span>Aborting…</span>
        </output>
      </div>
    </div>

    <div v-if="showRunningIndicator" class="flex justify-start">
      <div class="ml-9 max-w-[85%]">
        <output
          class="flex gap-1 items-center mb-1"
          aria-label="Agent is typing"
          aria-live="polite"
        >
          <span
            v-for="i in 3" :key="i"
            class="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 dark:bg-blue-300 animate-bounce"
            :style="{ animationDelay: `${(i - 1) * 0.15}s` }"
            aria-hidden="true"
          />
        </output>
        <div class="rounded-2xl rounded-tl-sm border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-2">
          <div class="text-sm font-medium text-blue-900 dark:text-blue-100">Working on it…</div>
          <div v-if="stepProgressLabel" class="text-xs text-blue-700 dark:text-blue-300 mt-0.5">{{ stepProgressLabel }}</div>
        </div>
        <div class="mt-2">
          <TaskChatAbortButton :submitting="abortSubmitting" @abort="emit('abort')" />
        </div>
      </div>
    </div>

    <div v-if="task.status === 'COMPLETED' && task.final_response" class="flex justify-start">
      <div class="flex gap-2.5 max-w-[85%]">
        <div class="shrink-0 h-7 w-7 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center text-xs font-semibold text-green-700 dark:text-green-300 mt-0.5">
          ✓
        </div>
        <div class="flex flex-col gap-1.5">
          <div class="rounded-2xl rounded-tl-sm border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-4 py-2.5 text-sm chat-bubble-content text-green-900 dark:text-green-100">
              <div v-html="renderMarkdown(task.final_response ?? '')" />
          </div>
          <RouterLink
            v-if="handoverBreadcrumb"
            :to="{ name: 'agent', params: { id: String(handoverBreadcrumb.targetAgentId) } }"
            class="self-start ml-1 inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100 underline-offset-2 hover:underline transition-colors"
          >
            Open {{ handoverBreadcrumb.targetAgentName }} →
          </RouterLink>
        </div>
      </div>
    </div>

    <TaskFailedBanner v-if="task.status === 'FAILED'" :step-count="task.step_count" />

    <div ref="bottomEl"></div>
  </div>
</template>
