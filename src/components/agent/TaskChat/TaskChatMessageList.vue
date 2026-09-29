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
 * "Iteration 4" splits the chat into blocks at each user message and at
 * each sub-agent tool result. A block renders one CompactToolStream pill
 * (collapsed by default) for its reasoning + tool calls, plus the final
 * assistant response as a normal bubble after the pill.
 */
import { computed, ref, watch } from 'vue'
import type { TaskDetail, HistoryEntry } from '@/types/task'
import type { ChatMessage, ChatBlock } from '@/composables/useTaskChat'
import {
  buildChatBlocks,
  toolCallForEntry,
  isSubAgentToolResult,
  reasoningForChatMessage,
} from '@/composables/useTaskChat'
import { renderMarkdown } from '@/composables/useMarkdown'
import { Icon } from '@spora-ai/components/icons'
import ImageOverlay from '@/components/ui/ImageOverlay.vue'
import { Avatar } from '@spora-ai/components/avatar'
import TaskFailedBanner from '@/components/agent/TaskFailedBanner.vue'
import SubAgentToolCall from '@/components/agent/TaskChat/SubAgentToolCall.vue'
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
 * Abort-marker divider label, in the viewer's local timezone — the backend
 * writes UTC. Falls back to the raw string when the date is unparseable.
 */
function formatAbortMarkerAt(iso: string): string {
  const formatted = new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
  return formatted === 'Invalid Date' ? iso : formatted
}

const taskStore = useTaskStore()

// Null when `max_steps` is unknown — better to render "Working…" than a
// misleading "Step 0 of 0".
const stepProgressLabel = computed(() => {
  const stepCount = props.task.step_count ?? 0
  const maxSteps = props.task.max_steps ?? null
  if (typeof maxSteps !== 'number' || maxSteps <= 0) return null
  return `Step ${stepCount} of ${maxSteps}`
})

// `abortSubmitting` is OR'd in so the row survives `task.status` racing to
// ABORTED over SSE — the operator still needs click acknowledgement while
// the HTTP response is in flight.
const showSubtleRunningIndicator = computed<boolean>(
  () => taskStore.isDriving(props.task.id)
    || props.task.status === 'RUNNING'
    || props.abortSubmitting === true,
)
// `currentAgent` is populated by `TaskChatPage.fetchAgent()` on mount.
const agentStore = useAgentStore()
const agentName = computed<string>(() => agentStore.currentAgent?.name ?? '')
const agentProfilePicture = computed(() => agentStore.currentAgent?.profile_picture ?? null)

/**
 * Source-task breadcrumb from `HandoverService::handover`. The backend
 * writes `data.handover` in snake_case; normalised to camelCase here.
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

// SubAgent rows keep their own surface; this map lets the render loop look
// up the ToolCall for each row that escapes the pill.
const subAgentToolCalls = computed(() => {
  const out = new Map<number, ReturnType<typeof toolCallForEntry>>()
  for (const msg of props.chatMessages) {
    if (!isSubAgentToolResult(props.task, msg)) continue
    out.set(msg.entry.sequence, toolCallForEntry(props.task, msg))
  }
  return out
})

// The pill mounts only when the block carries at least one renderable row,
// otherwise the chain renders empty.
function blockHasRows(block: ChatBlock): boolean {
  for (const m of block.messages) {
    if (m.kind === 'tool-result') {
      if (!isSubAgentToolResult(props.task, m)) return true
    } else if (m.kind === 'assistant') {
      if (reasoningForChatMessage(m) !== null) return true
    }
  }
  return false
}

// `block.id` doubles as the lookup into `props.expandedStreams`.
const chatBlocks = computed<ChatBlock[]>(() => buildChatBlocks(props.chatMessages, props.task))

// Reasoning-only assistant messages are absorbed into the pill.
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
 * Keyboard companion to {@link onBubbleContentClick}, required by a11y
 * checkers on the delegated root div. A no-op: `<img>` in `v-html` bubble
 * output is not tab-focusable, so Enter/Space activation needs
 * `tabindex`/`role` post-processing in `useMarkdown.ts` first.
 */
function onBubbleContentKeydown(_event: KeyboardEvent): void { // eslint-disable-line no-unused-vars -- no-op handler; see JSDoc above
}

/**
 * Opens the overlay for a click on an `<img>` inside a `.chat-bubble-content`
 * div. Skips a release that ends a text selection, so a fast click on
 * adjacent text does not clear the selection and open the overlay.
 */
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
 * Resolves every `entry.attachments[*].media_id` in the chat history into
 * `MediaAsset` payloads so bubbles render without N+1.
 */
const mediaCache = useMediaAssetCache()

// Per-entry `media_id → MediaAsset` map. Unlike the module-level cache this
// is rebuilt on remount, so a fresh chat never inherits stale assets.
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
  // Server-classified from the asset's stored mime. The resolved
  // `MediaAsset.media_type` is deliberately not consulted, so the chip can
  // decide before the asset lands in cache.
  return att.kind === 'image'
}

/**
 * Audio test reads `media_type` off the resolved asset, not the wire
 * `kind` — the orchestrator emits `kind: 'text'` for anything that is
 * not an image. Best-effort: false while the asset is still uncached.
 */
function isAudioAttachmentForEntry(entry: HistoryEntry, att: { media_id: string; kind: 'image' | 'text' }): boolean {
  const asset = assetForEntry(entry, att.media_id)
  if (asset === null) {
    return false
  }
  return (asset.media_type ?? '').toLowerCase() === 'audio'
}

// `immediate` because the page mounts this with an already-populated
// `chatMessages` prop; terminal tasks never re-poll, so a non-immediate
// watcher would leave their chips unresolved.
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
      <div
        v-if="block.userMessage"
        class="flex justify-end"
      >
        <div
          class="max-w-[95%] lg:max-w-[75%] flex flex-col items-end gap-1.5"
          data-testid="user-message-bubble"
        >
          <div
            v-if="block.userMessage.attachments && block.userMessage.attachments.length > 0"
            class="flex flex-wrap gap-1.5 justify-end"
            data-testid="user-message-attachments"
          >
            <!--
              Resolved chips are `<a>`; unresolved ones stay a disabled
              `<span>` so a cache-miss click cannot jump the page to `#`
              and lose the operator's scroll position.
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
              <!-- Audio replays inline from the same resolved URL. -->
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
        Generic tool-result rows fall through silently so no empty wrapper
        div is left behind.
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
                :name="agentName"
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
        Each pill tracks its own expanded state via `expandedStreams[block.id]`;
        the parent's v-for key is the block id so per-block state survives.
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
        The block's trailing assistant response renders AFTER the pill so
        the conversational flow stays readable.
      -->
      <div
        v-if="block.finalResponseEntry"
        class="flex justify-start"
      >
        <div class="flex gap-2.5 max-w-[95%] lg:max-w-[85%] min-w-0">
          <div class="hidden lg:flex shrink-0 mt-0.5">
            <Avatar
              :name="agentName"
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
      Hosts the canonical Abort affordance + step counter, so the chat
      always has exactly one way to cancel an in-flight agent loop.
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
      Must render independently of `task.status`: Mercure publishes the
      ABORTED status over SSE before the HTTP response arrives, so
      keying the spinner off `task.status` would hide it the instant the
      operator clicks Abort.
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
            :name="agentName"
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
