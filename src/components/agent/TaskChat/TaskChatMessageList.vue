<script setup lang="ts">
/**
 * TaskChatMessageList — the scrollable chat history.
 *
 * Renders the user/assistant/tool bubbles, the compact tool-stream pills
 * (one per user turn + one per sub-agent boundary), the failed banner,
 * the running indicator, and a scroll anchor. The page owns the scroll
 * lifecycle and calls `scrollToBottom` after fetches + on new history
 * entries.
 *
 * Iteration 4 splits the chat into "blocks": each block opens at a
 * user message or a sub-agent tool result. Reasoning + tool calls +
 * the final assistant response for that block all render together
 * under one CompactToolStream pill (collapsed by default), keeping the
 * conversation readable across multiple user turns. The pill surfaces
 * its own per-row rows for reasoning and tool results; the final
 * assistant response renders as a normal assistant bubble after the
 * pill so the conversational flow stays clear.
 *
 * Specialised tool surfaces (SubAgentToolCall, TodoToolCall) keep their
 * dedicated cards and are filtered out of the generic stream — see the
 * per-message render loop. Loaded-skill rows flow into the pill as
 * `data-row-kind="loaded-skill"` rows so they share the same
 * expand/collapse UX as the generic case.
 */
import { computed, ref, watch } from 'vue'
import type { TaskDetail, HistoryEntry } from '@/types/task'
import type { ChatMessage, ChatBlock } from '@/composables/useTaskChat'
import {
  buildChatBlocks,
  toolCallForEntry,
  isSubAgentToolResult,
  isTodoWriteToolResult,
  reasoningForChatMessage,
} from '@/composables/useTaskChat'
import { renderMarkdown } from '@/composables/useMarkdown'
import Icon from '@/components/ui/Icon.vue'
import ImageOverlay from '@/components/ui/ImageOverlay.vue'
import Avatar from '@/components/ui/Avatar.vue'
import TaskFailedBanner from '@/components/agent/TaskFailedBanner.vue'
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
  /** Per-sequence expanded flag; owned by the page so it survives remounts. */
  expandedTools?: Record<number, boolean>
  /**
   * Per-block expanded flag, keyed by `block.id`. Each pill tracks its
   * own collapsed state independently — collapsing turn 2's pill
   * leaves turn 1's pill alone.
   */
  expandedStreams?: Record<number, boolean>
  /** Disable the abort button while the request is in flight. */
  abortSubmitting?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  expandedTools: () => ({}),
  expandedStreams: () => ({}),
  abortSubmitting: false,
})

const emit = defineEmits<{
  toggleExpanded: [sequence: number]
  toggleStream: [blockId: number]
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
 * The compact pill's own in-flight state (shimmer + pulsing current-cell)
 * is driven from `taskStore.drivingTaskIds` and the task status directly.
 * The legacy blue "Working on it…" + bouncing-dots indicator was removed
 * in favour of the pill surface so the chat doesn't carry two separate
 * progress signals at once.
 *
 * A *subtle* fallback indicator still surfaces progress for turns that
 * have no pill to render (the agent is reasoning before any tool call,
 * or the last block has no tool-result rows to summarise). It's gated on
 * `lastBlockHasPill` so it never duplicates the pill's progress signal.
 */
const taskStore = useTaskStore()

/**
 * "Step 3 of 5" subtitle. Surfaces progress through the agent loop so
 * the operator sees the loop advancing even when no tool has fired yet.
 * Hidden when `max_steps` isn't known yet — better to render "Working…"
 * than a misleading "Step 0 of 0".
 */
const stepProgressLabel = computed(() => {
  const stepCount = props.task.step_count ?? 0
  const maxSteps = props.task.max_steps ?? null
  if (typeof maxSteps !== 'number' || maxSteps <= 0) return null
  return `Step ${stepCount} of ${maxSteps}`
})

/**
 * Visible whenever the agent is in flight — regardless of whether the
 * pill is rendering. The indicator hosts the canonical Abort button +
 * step counter, both of which the operator needs throughout the entire
 * agent loop (the pill's inline abort is a convenience for when the
 * indicator is far down the chat timeline). `abortSubmitting` does NOT
 * hide the indicator — it flips the abort button label to "Aborting…"
 * so the operator sees click acknowledgement even after `task.status`
 * races to ABORTED via SSE.
 */
const showSubtleRunningIndicator = computed<boolean>(
  () => taskStore.isDriving(props.task.id)
    || props.task.status === 'RUNNING'
    || props.abortSubmitting === true,
)
// `currentAgent` is populated by `TaskChatPage.fetchAgent()` on mount.
const agentStore = useAgentStore()
const agentInitials = computed<string>(
  () => agentStore.currentAgent?.name?.charAt(0).toUpperCase() ?? '?',
)
const agentProfilePicture = computed(() => agentStore.currentAgent?.profile_picture ?? null)

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
 * SubAgent and TodoToolCall rows keep their own specialised surfaces
 * — this map (keyed by `entry.sequence`) lets the per-message render
 * loop look up the right `ToolCall` for each row that escapes the
 * pill. The pill itself filters these out using the same composable
 * helpers; the parent needs them too so the per-message render can
 * decide whether to mount `SubAgentToolCall` or `TodoToolCall`.
 */
const subAgentToolCalls = computed(() => {
  const out = new Map<number, ReturnType<typeof toolCallForEntry>>()
  for (const msg of props.chatMessages) {
    if (!isSubAgentToolResult(props.task, msg)) continue
    out.set(msg.entry.sequence, toolCallForEntry(props.task, msg))
  }
  return out
})

const todoToolCalls = computed(() => {
  const out = new Map<number, ReturnType<typeof toolCallForEntry>>()
  for (const msg of props.chatMessages) {
    if (!isTodoWriteToolResult(props.task, msg)) continue
    out.set(msg.entry.sequence, toolCallForEntry(props.task, msg))
  }
  return out
})

/**
 * `true` when the chat stream carries at least one entry that the
 * CompactToolStream pill can render — a non-sub-agent, non-todo
 * tool-result OR an assistant message with displayable reasoning. The
 * pill mounts only when this is true; otherwise the chain would render
 * empty. The per-message render loop still handles SubAgent / TodoTool
 * rows on its own.
 *
 * Iteration 4 splits the chat into blocks — each block has its own
 * pill. The parent renders the pill per-block so this helper reports
 * only the rows the block carries.
 */
function blockHasRows(block: ChatBlock): boolean {
  for (const m of block.messages) {
    if (m.kind === 'tool-result') {
      if (!isSubAgentToolResult(props.task, m) && !isTodoWriteToolResult(props.task, m)) return true
    } else if (m.kind === 'assistant') {
      if (reasoningForChatMessage(m) !== null) return true
    }
  }
  return false
}

/**
 * Compute the per-turn blocks once when the chat stream changes. Block
 * boundaries are placed at every user message and every sub-agent tool
 * result (see {@link buildChatBlocks}). The v-for in the template keys
 * on `block.id`, which doubles as the lookup into
 * `props.expandedStreams`.
 */
const chatBlocks = computed<ChatBlock[]>(() => buildChatBlocks(props.chatMessages, props.task))

/**
 * True for assistant entries that should render as inline bubbles
 * (non-empty content AND not the block's chosen final response).
 * Reasoning-only assistant messages are absorbed into the pill; the
 * chosen final response renders separately after the pill.
 */
function isIntermediateAssistant(block: ChatBlock, msg: ChatMessage): boolean {
  if (msg.kind !== 'assistant') return false
  if (msg.entry === block.finalResponseEntry) return false
  const content = msg.entry.content?.trim() ?? ''
  return content.length > 0
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
      v-for="block in chatBlocks"
      :key="block.id"
    >
      <!--
        1. User message bubble (only on blocks opened by a user message;
        sub-agent blocks have no user bubble of their own — the parent
        turn's user bubble already rendered at the top of the previous
        block).
      -->
      <div
        v-if="block.userMessage"
        class="flex justify-end"
      >
        <div class="max-w-[95%] lg:max-w-[75%] flex flex-col items-end gap-1.5" data-testid="user-message-bubble">
          <div
            v-if="block.userMessage.attachments && block.userMessage.attachments.length > 0"
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
              v-for="att in block.userMessage.attachments"
              :key="att.media_id"
            >
              <a
                v-if="assetUrlForEntry(block.userMessage, att.media_id) && !isAudioAttachmentForEntry(block.userMessage, att)"
                :href="assetUrlForEntry(block.userMessage, att.media_id) ?? '#'"
                target="_blank"
                rel="noopener noreferrer"
                :title="filenameForEntry(block.userMessage, att.media_id) ?? att.media_id"
                class="inline-flex items-center gap-1.5 rounded-full bg-primary/80 hover:bg-primary/70 pl-1 pr-2 py-0.5 text-xs text-primary-foreground transition-colors max-w-[200px]"
                data-testid="user-message-attachment"
              >
                <img
                  v-if="isImageAttachment(att)"
                  :src="assetUrlForEntry(block.userMessage, att.media_id) ?? undefined"
                  :alt="filenameForEntry(block.userMessage, att.media_id) ?? att.media_id"
                  class="h-5 w-5 rounded-full object-cover bg-primary-foreground/20"
                >
                <Icon
                  v-else
                  name="file"
                  class="h-3.5 w-3.5"
                  aria-hidden="true"
                />
                <span class="truncate">{{ filenameForEntry(block.userMessage, att.media_id) ?? att.media_id.slice(0, 8) }}</span>
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
                v-else-if="isAudioAttachmentForEntry(block.userMessage, att) && assetUrlForEntry(block.userMessage, att.media_id)"
                class="inline-flex items-center gap-1.5 rounded-full bg-primary/80 pl-2 pr-1 py-0.5 text-xs text-primary-foreground max-w-[260px]"
                data-testid="user-message-attachment-audio"
                :title="filenameForEntry(block.userMessage, att.media_id) ?? att.media_id"
              >
                <Icon
                  name="music"
                  class="h-3 w-3 shrink-0"
                  aria-hidden="true"
                />
                <span class="truncate max-w-[120px]">{{ filenameForEntry(block.userMessage, att.media_id) ?? att.media_id.slice(0, 8) }}</span>
                <audio
                  :src="assetUrlForEntry(block.userMessage, att.media_id) ?? undefined"
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
            {{ block.userMessage.content }}
          </div>
        </div>
      </div>

      <!--
        2. Per-block message renders — SubAgent card, Todo card,
        system-marker divider, and intermediate assistant bubbles. Each
        block iterates only its own messages so a sub-agent's own block
        contains its own reasoning + tool calls + final response.
        Generic tool-result rows are skipped here (they flow into the
        pill below) — the v-if/v-else-if chain falls through silently
        for them so no empty wrapper div is left behind (regression
        guard from iteration 3).
      -->
      <template
        v-for="msg in block.messages"
        :key="msg.entry.sequence"
      >
        <div
          v-if="msg.kind === 'tool-result' && subAgentToolCalls.get(msg.entry.sequence)"
          class="flex justify-start"
        >
          <SubAgentToolCall
            :tool-call="subAgentToolCalls.get(msg.entry.sequence)!"
          />
        </div>
        <div
          v-else-if="msg.kind === 'tool-result' && todoToolCalls.get(msg.entry.sequence)"
          class="flex justify-start"
        >
          <TodoToolCall
            :tool-call="todoToolCalls.get(msg.entry.sequence)!"
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
        <div
          v-else-if="isIntermediateAssistant(block, msg)"
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

      <!--
        3. CompactToolStream pill — collapsed by default, summarises
        the block's reasoning + tool calls. Each pill tracks its own
        expanded state via `expandedStreams[block.id]`; the parent's
        v-for key is the block id so per-block state survives.
      -->
      <div
        v-if="blockHasRows(block)"
        class="flex justify-start"
        :data-testid="`chat-block-pill-${block.id}`"
      >
        <CompactToolStream
          :task="props.task"
          :messages="block.messages"
          :expanded-tools="props.expandedTools"
          :expanded-stream="props.expandedStreams[block.id] ?? false"
          @toggle-expanded="(s: number) => emit('toggleExpanded', s)"
          @toggle-stream="emit('toggleStream', block.id)"
        />
      </div>

      <!--
        4. Final response bubble — the LAST assistant message with
        non-empty content for this block. Rendered as a normal
        assistant bubble after the pill so the conversational flow
        stays readable. Reasoning-only messages and intermediate
        assistant messages render above (the latter inline, the former
        inside the pill) — this is the block's trailing response.
      -->
      <div
        v-if="block.finalResponseEntry"
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
              v-html="renderMarkdown(block.finalResponseEntry.content ?? '')"
            />
          </div>
        </div>
      </div>
    </template>

    <!--
      Subtle progress row shown when no pill is rendering for the
      current turn (agent is reasoning before the first tool call, or
      the last block has no tool-result rows to summarise). It hosts
      the abort affordance for those turns so the chat always has
      exactly one way to cancel an in-flight agent loop. The pill itself
      owns abort on turns that DO render a pill — see CompactToolStream.
    -->
    <div
      v-if="showSubtleRunningIndicator"
      class="flex justify-start"
      data-testid="subtle-running-indicator"
    >
      <div class="lg:ml-9 inline-flex items-center gap-2.5 text-[11px] text-muted-foreground">
        <output
          class="inline-flex items-center gap-2"
          aria-live="polite"
          aria-label="Agent is working"
        >
          <Icon
            name="loader-2"
            class="h-3 w-3 animate-spin shrink-0"
          />
          <span>{{ stepProgressLabel ?? 'Working…' }}</span>
        </output>
        <button
          type="button"
          class="ml-1 inline-flex items-center text-[11px] font-medium text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border hover:bg-muted/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="abortSubmitting === true"
          data-testid="subtle-running-indicator-abort"
          @click="emit('abort')"
        >
          {{ abortSubmitting === true ? 'Aborting…' : 'Abort' }}
        </button>
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
