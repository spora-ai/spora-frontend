<script setup lang="ts">
/**
 * TaskChatMessageList — the scrollable chat history.
 *
 * Renders the user/assistant/tool bubbles, the compact tool-stream pill
 * (replacing the per-tool generic card), the final-response pill, the
 * failed banner, the running indicator, and a scroll anchor. The page
 * owns the scroll lifecycle and calls `scrollToBottom` after fetches +
 * on new history entries.
 *
 * Per-message Reasoning foldouts continue to render per assistant row.
 * Specialised tool surfaces (SubAgentToolCall, TodoToolCall) keep their
 * dedicated cards and are filtered out of the generic stream — see
 * `genericToolResults` computed below. Loaded-skill rows flow into the
 * pill as `data-row-kind="loaded-skill"` rows so they share the same
 * expand/collapse UX as the generic case.
 */
import { computed, ref, watch } from 'vue'
import type { TaskDetail, HistoryEntry, ToolCall } from '@/types/task'
import type { ChatMessage } from '@/composables/useTaskChat'
import {
  toolCallForEntry,
  toolResultDataByCallId,
  thinkingBlocks,
} from '@/composables/useTaskChat'
import { renderMarkdown } from '@/composables/useMarkdown'
import Icon from '@/components/ui/Icon.vue'
import ImageOverlay from '@/components/ui/ImageOverlay.vue'
import Avatar from '@/components/ui/Avatar.vue'
import TaskFailedBanner from '@/components/agent/TaskFailedBanner.vue'
import TaskChatAbortButton from '@/components/agent/TaskChat/TaskChatAbortButton.vue'
import SubAgentToolCall from '@/components/agent/TaskChat/SubAgentToolCall.vue'
import TodoToolCall from '@/components/agent/TaskChat/TodoToolCall.vue'
import CompactToolStream from '@/components/agent/TaskChat/CompactToolStream.vue'
import { useAgentStore } from '@/stores/agent'
import { useTaskStore } from '@/stores/tasks'
import { useMediaAssetCache } from '@/composables/useMediaAssetCache'
import type { MediaAsset } from '@/types/media'

interface Props {
  task: TaskDetail
  chatMessages: ChatMessage[]
  finalReasoning: string | null
  /** Per-sequence expanded flag; owned by the page so it survives remounts. */
  expandedTools?: Record<number, boolean>
  /** Page-owned flag for the CompactToolStream pill itself (separate from per-row). */
  expandedStream?: boolean
  /** Disable the abort button while the request is in flight. */
  abortSubmitting?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  expandedTools: () => ({}),
  expandedStream: false,
  abortSubmitting: false,
})

const emit = defineEmits<{
  toggleExpanded: [sequence: number]
  toggleStream: []
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

// `currentAgent` is populated by `TaskChatPage.fetchAgent()` on mount.
const agentStore = useAgentStore()
const agentInitials = computed<string>(
  () => agentStore.currentAgent?.name?.charAt(0).toUpperCase() ?? '?',
)
const agentProfilePicture = computed(() => agentStore.currentAgent?.profile_picture ?? null)

// History rows carry the LLM-side id (provider_call_id); the DB id is
// indexed alongside as a fallback for older runs.
const toolResultDataByHistoryCallId = computed(() => toolResultDataByCallId(props.task))

function resultDataForEntry(entry: ChatMessage): Record<string, unknown> | null {
  if (entry.kind !== 'tool-result') return null
  const callId = entry.entry.tool_call_id
  if (!callId) return null
  return toolResultDataByHistoryCallId.value.get(callId) ?? null
}

/**
 * `TodoTool` rows get their own compact "Plan updated" card instead of
 * the standard tool-result card. Every successful `write` op should
 * surface here — failed writes fall through to the generic card so
 * the operator sees the error in context.
 */
function toolResultIsTodo(entry: ChatMessage): boolean {
  if (entry.kind !== 'tool-result') return false
  if (entry.entry.tool_name !== 'todo') return false
  const tc = toolCallForEntry(props.task, entry)
  if (!tc) return false
  if (tc.status === 'FAILED' || tc.status === 'REJECTED') return false
  if (tc.operation !== null && tc.operation !== 'write') return false
  return true
}

const todoToolCallBySequence = computed<Map<number, ToolCall | null>>(() => {
  const map = new Map<number, ToolCall | null>()
  for (const msg of props.chatMessages) {
    if (msg.kind !== 'tool-result') continue
    map.set(msg.entry.sequence, toolResultIsTodo(msg) ? toolCallForEntry(props.task, msg) : null)
  }
  return map
})

/**
 * Tool-result rows that collapse into the CompactToolStream pill. SubAgent
 * and TodoToolCall rows keep their own specialised surfaces; loaded-skill
 * rows flow into the pill as `data-row-kind="loaded-skill"` rows so they
 * share the same expand/collapse UX as the generic case.
 */
const genericToolResults = computed<ChatMessage[]>(() => {
  return props.chatMessages.filter((msg) => {
    if (msg.kind !== 'tool-result') return false
    if (toolResultIsSubAgent(msg)) return false
    if (todoToolCallBySequence.value.get(msg.entry.sequence)) return false
    return true
  })
})

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
 * Resolve which reasoning text to render for an assistant message.
 *
 * LLMs may emit multiple `thinking` blocks per turn (e.g. reasoning before
 * a tool-use, then more reasoning after the tool results). We concat them
 * with a blank line between blocks so the foldout preserves order.
 *
 * The `redacted_thinking` block type intentionally does NOT supply
 * displayable reasoning text, so rows containing only redacted thinking
 * do not render a per-message foldout.
 */
function reasoningForEntry(entry: HistoryEntry): string | null {
  if (entry.role !== 'assistant') return null
  const thinkings = thinkingBlocks(entry.content_blocks)
  if (thinkings.length === 0) return null
  return thinkings.join('\n\n')
}

defineExpose({
  scrollToBottom,
  clearEntryAssets(): void {
    entryAssets.value = new Map()
  },
})

/**
 * Single-instance image overlay — every chat bubble shares one ImageOverlay
 * mounted at the bottom of this component (rather than one per bubble) so
 * there's a single z-index source, focus trap, and backdrop. `src` doubles
 * as the open/close signal: a non-empty src means the overlay is open.
 */
const overlayOpen = ref(false)
const overlaySrc = ref('')
const overlayAlt = ref('')

function openImageOverlay(src: string, alt: string): void {
  overlaySrc.value = src
  overlayAlt.value = alt
  overlayOpen.value = true
}

/**
 * Delegated handler for clicks inside any `.chat-bubble-content` div. Only
 * opens the overlay when the click target is an `<img>` that lives inside a
 * `.chat-bubble-content` (so user-attachment thumbnails and avatars outside
 * the bubble div are unaffected), and skips the case where the operator has
 * just dragged a text selection that happens to release over an image —
 * without the guard a fast click on adjacent paragraph text would close
 * the selection and open the overlay unintentionally.
 */
/**
 * Keyboard-event companion to {@link onBubbleContentClick}. Required by
 * accessibility checkers (Sonar: click-without-keydown) on the delegated
 * root div. The handler is currently a no-op because `<img>` elements in
 * `v-html`'d chat-bubble output are not natively tab-focusable, so
 * keyboard focus never lands on them — making Enter/Space activation a
 * follow-up that needs `tabindex="0"` + `role="button"` post-processing
 * in `useMarkdown.ts` (tracked separately). Documented here so the next
 * implementation knows where to plug in.
 */
function onBubbleContentKeydown(_event: KeyboardEvent): void { // eslint-disable-line no-unused-vars -- no-op handler; see JSDoc above
}

function onBubbleContentClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (!target || target.tagName !== 'IMG') return
  if (!target.closest('.chat-bubble-content')) return
  const selection = typeof window !== 'undefined' ? window.getSelection?.() : null
  if (selection && selection.toString().length > 0) return
  const img = target as HTMLImageElement
  if (!img.src) return
  openImageOverlay(img.src, img.alt)
}

/**
 * Module-level media-asset cache + batch resolver. Resolves every
 * `entry.attachments[*].media_id` referenced from the chat history
 * into `MediaAsset` payloads the bubble can render without N+1.
 */
const mediaCache = useMediaAssetCache()

/**
 * Per-entry attachment chip state — keyed by `entry.sequence`, value is
 * the resolved `media_id → MediaAsset` map for that entry. The
 * module-level {@link useMediaAssetCache} survives component remounts;
 * this per-component map is rebuilt on every remount and is *not*
 * persisted across navigations (intentional: a fresh chat should not
 * inherit stale resolved assets from a previous task).
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
  // Server-classified by Orchestrator::appendAttachmentRow from the asset's
  // stored mime — the resolved `MediaAsset.media_type` is intentionally
  // NOT consulted here so the chip render does not need the asset in
  // cache before deciding whether to draw a thumbnail.
  return att.kind === 'image'
}

/**
 * Resolve the cached `MediaAsset` for an attachment and report whether
 * the server classified it as audio (`MediaType::Audio`). The orchestrator
 * currently emits `kind: 'text'` for everything that isn't an image, so
 * the chip render reads `media_type` from the resolved asset instead of
 * the wire-shape `kind`. The lookup is best-effort: when the asset isn't
 * in cache yet, this returns false and the chip falls back to the generic
 * file icon until the next render tick after the batch resolve.
 */
function isAudioAttachmentForEntry(entry: HistoryEntry, att: { media_id: string; kind: 'image' | 'text' }): boolean {
  const asset = assetForEntry(entry, att.media_id)
  if (asset === null) {
    return false
  }
  return (asset.media_type ?? '').toLowerCase() === 'audio'
}

/**
 * Watch the chat messages list for newly-appeared attachment refs and
 * batch-resolve them. The watcher is `immediate` because the page
 * mounts this component with a populated `chatMessages` prop (after
 * `taskStore.fetchTaskDetail` resolves); a non-immediate watcher
 * would miss the initial render and chips would never resolve for
 * terminal tasks that never re-poll.
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
  { flush: 'post', immediate: true },
)
</script>

<template>
  <div
    class="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-3"
    data-testid="chat-message-list"
    @click="onBubbleContentClick"
    @keydown="onBubbleContentKeydown"
  >
    <template
      v-for="msg in chatMessages"
      :key="msg.entry.sequence"
    >
      <div
        v-if="msg.kind === 'user'"
        class="flex justify-end"
      >
        <div class="max-w-[95%] lg:max-w-[75%] flex flex-col items-end gap-1.5" data-testid="user-message-bubble">
          <div
            v-if="msg.entry.attachments && msg.entry.attachments.length > 0"
            class="flex flex-wrap gap-1.5 justify-end"
            data-testid="user-message-attachments"
          >
            <!--
              Each chip needs a click target. We render `<a>` when the
              asset has been resolved and `<span>` (with aria-disabled)
              during the cache-miss window — clicking an unresolved chip
              would otherwise jump the page to `#` and lose the user's
              scroll position. The watcher (immediate: true) resolves
              assets on first paint so this branch is the exception, not
              the rule.
            -->
            <template
              v-for="att in msg.entry.attachments"
              :key="att.media_id"
            >
              <a
                v-if="assetUrlForEntry(msg.entry, att.media_id) && !isAudioAttachmentForEntry(msg.entry, att)"
                :href="assetUrlForEntry(msg.entry, att.media_id) ?? '#'"
                target="_blank"
                rel="noopener noreferrer"
                :title="filenameForEntry(msg.entry, att.media_id) ?? att.media_id"
                class="inline-flex items-center gap-1.5 rounded-full bg-primary/80 hover:bg-primary/70 pl-1 pr-2 py-0.5 text-xs text-primary-foreground transition-colors max-w-[200px]"
                data-testid="user-message-attachment"
              >
                <img
                  v-if="isImageAttachment(att)"
                  :src="assetUrlForEntry(msg.entry, att.media_id) ?? undefined"
                  :alt="filenameForEntry(msg.entry, att.media_id) ?? att.media_id"
                  class="h-5 w-5 rounded-full object-cover bg-primary-foreground/20"
                >
                <Icon
                  v-else
                  name="file"
                  class="h-3.5 w-3.5"
                  aria-hidden="true"
                />
                <span class="truncate">{{ filenameForEntry(msg.entry, att.media_id) ?? att.media_id.slice(0, 8) }}</span>
              </a>
              <!--
                Audio attachments render an inline <audio> chip so the
                operator can replay the original recording without
                downloading the file. The resolved `asset_url` is the
                same URL the chip's `href` would have used; the audio
                element streams the same bytes. Preload=none keeps the
                chat page lightweight when many audio attachments load
                at once.
              -->
              <span
                v-else-if="isAudioAttachmentForEntry(msg.entry, att) && assetUrlForEntry(msg.entry, att.media_id)"
                class="inline-flex items-center gap-1.5 rounded-full bg-primary/80 pl-2 pr-1 py-0.5 text-xs text-primary-foreground max-w-[260px]"
                data-testid="user-message-attachment-audio"
                :title="filenameForEntry(msg.entry, att.media_id) ?? att.media_id"
              >
                <Icon
                  name="music"
                  class="h-3 w-3 shrink-0"
                  aria-hidden="true"
                />
                <span class="truncate max-w-[120px]">{{ filenameForEntry(msg.entry, att.media_id) ?? att.media_id.slice(0, 8) }}</span>
                <audio
                  :src="assetUrlForEntry(msg.entry, att.media_id) ?? undefined"
                  controls
                  preload="none"
                  class="h-6 max-w-[140px]"
                />
              </span>
              <span
                v-else
                :title="att.media_id"
                aria-disabled="true"
                class="inline-flex items-center gap-1.5 rounded-full bg-primary/40 pl-1 pr-2 py-0.5 text-xs text-primary-foreground/70 max-w-[200px] cursor-not-allowed"
                data-testid="user-message-attachment-pending"
              >
                <Icon
                  name="file"
                  class="h-3.5 w-3.5"
                  aria-hidden="true"
                />
                <span class="truncate">{{ att.media_id.slice(0, 8) }}</span>
              </span>
            </template>
          </div>
          <div class="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground whitespace-pre-wrap">
            {{ msg.entry.content }}
          </div>
        </div>
      </div>

      <template v-if="msg.kind === 'assistant'">
        <div
          v-if="reasoningForEntry(msg.entry)"
          class="flex justify-start -mb-1.5"
        >
          <div class="lg:ml-9 mt-1 text-xs text-muted-foreground w-full max-w-[95%] lg:max-w-[85%]">
            <details class="group">
              <summary class="inline-flex items-center gap-1.5 px-1.5 py-0.5 cursor-pointer select-none list-none text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                <Icon
                  name="chevron-right"
                  class="h-3 w-3 transition-transform group-open:rotate-90"
                />
                Reasoning
              </summary>
              <div
                class="mt-1.5 px-3 py-2 rounded-lg border border-border bg-muted/10 chat-bubble-content !text-[11px]"
                v-html="renderMarkdown(reasoningForEntry(msg.entry) ?? '')"
              />
            </details>
          </div>
        </div>

        <div
          v-if="msg.entry.content"
          class="flex justify-start"
        >
          <div class="flex gap-2.5 max-w-[95%] lg:max-w-[85%] min-w-0">
            <div class="hidden lg:flex shrink-0 mt-0.5">
              <Avatar
                :initials="agentInitials"
                :profile-picture="agentProfilePicture"
                size="sm"
              />
            </div>
            <div class="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5 text-sm">
              <div
                class="chat-bubble-content"
                v-html="renderMarkdown(msg.entry.content ?? '')"
              />
            </div>
          </div>
        </div>
      </template>

      <div
        v-if="msg.kind === 'tool-result'"
        class="flex justify-start"
      >
        <SubAgentToolCall
          v-if="toolResultIsSubAgent(msg) && toolCallForEntry(props.task, msg)"
          :tool-call="toolCallForEntry(props.task, msg)!"
        />
        <TodoToolCall
          v-else-if="todoToolCallBySequence.get(msg.entry.sequence)"
          :tool-call="todoToolCallBySequence.get(msg.entry.sequence)!"
        />
      </div>

      <div
        v-else-if="msg.kind === 'system-marker'"
        class="flex justify-center my-1"
        data-testid="abort-marker"
      >
        <div class="inline-flex items-center gap-2 px-3 py-0.5 text-[11px] text-stone-500 dark:text-stone-400">
          <span
            class="h-px w-8 bg-stone-300 dark:bg-stone-700"
            aria-hidden="true"
          />
          <Icon
            name="x-circle"
            class="h-3 w-3 shrink-0"
          />
          <span class="font-medium tracking-wide uppercase">Aborted at {{ formatAbortMarkerAt(msg.marker.at) }}</span>
          <span
            class="h-px w-8 bg-stone-300 dark:bg-stone-700"
            aria-hidden="true"
          />
        </div>
      </div>
    </template>

    <div
      v-if="genericToolResults.length > 0"
      class="flex justify-start"
    >
      <CompactToolStream
        :task="props.task"
        :tool-results="genericToolResults"
        :expanded-tools="props.expandedTools"
        :expanded-stream="props.expandedStream"
        @toggle-expanded="(s: number) => emit('toggleExpanded', s)"
        @toggle-stream="emit('toggleStream')"
      />
    </div>

    <div
      v-if="finalReasoning"
      class="flex justify-start -mb-1.5"
    >
      <div class="ml-9 mt-1 text-xs text-muted-foreground w-full max-w-[85%]">
        <details class="group">
          <summary class="inline-flex items-center gap-1.5 px-1.5 py-0.5 cursor-pointer select-none list-none text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors">
            <Icon
              name="chevron-right"
              class="h-3 w-3 transition-transform group-open:rotate-90"
            />
            Reasoning
          </summary>
          <div
            class="mt-1.5 px-3 py-2 rounded-lg border border-border bg-muted/10 chat-bubble-content !text-[11px]"
            v-html="renderMarkdown(finalReasoning)"
          />
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
      <div class="lg:ml-9 px-3 py-2">
        <output
          class="flex items-center gap-2 text-[11px] text-muted-foreground"
          aria-live="polite"
          aria-label="Aborting agent loop"
        >
          <Icon
            name="loader-2"
            class="h-3 w-3 animate-spin"
          />
          <span>Aborting…</span>
        </output>
      </div>
    </div>

    <div
      v-if="showRunningIndicator"
      class="flex justify-start"
    >
      <div class="lg:ml-9 max-w-[95%] lg:max-w-[85%]">
        <output
          class="flex gap-1 items-center mb-1"
          aria-label="Agent is typing"
          aria-live="polite"
        >
          <span
            v-for="i in 3"
            :key="i"
            class="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 dark:bg-blue-300 animate-bounce"
            :style="{ animationDelay: `${(i - 1) * 0.15}s` }"
            aria-hidden="true"
          />
        </output>
        <div class="rounded-2xl rounded-tl-sm border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-2">
          <div class="text-sm font-medium text-blue-900 dark:text-blue-100">
            Working on it…
          </div>
          <div
            v-if="stepProgressLabel"
            class="text-xs text-blue-700 dark:text-blue-300 mt-0.5"
          >
            {{ stepProgressLabel }}
          </div>
        </div>
        <div class="mt-2">
          <TaskChatAbortButton
            :submitting="abortSubmitting"
            @abort="emit('abort')"
          />
        </div>
      </div>
    </div>

    <div
      v-if="task.status === 'COMPLETED' && task.final_response"
      class="flex justify-start"
    >
      <div class="flex gap-2.5 max-w-[95%] lg:max-w-[85%] min-w-0">
        <div class="hidden lg:flex shrink-0 mt-0.5">
          <Avatar
            :initials="agentInitials"
            :profile-picture="agentProfilePicture"
            size="sm"
          />
        </div>
        <div class="min-w-0 flex-1 flex flex-col gap-1.5">
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

    <TaskFailedBanner
      v-if="task.status === 'FAILED'"
      :step-count="task.step_count"
    />

    <ImageOverlay
      v-model:open="overlayOpen"
      :src="overlaySrc"
      :alt="overlayAlt"
    />

    <div ref="bottomEl" />
  </div>
</template>
