<script setup lang="ts">
/**
 * TaskChatFollowup — the bottom follow-up input bar.
 *
 * Shown when the task is COMPLETED, FAILED, or ABORTED and the agent
 * allows continuation. The page owns the state via `useTaskChatFollowup`
 * and passes the values + submit handler in as props so this component
 * stays presentational.
 *
 * Visual: a single-line chat input that grows with content up to ~8 rows,
 * sits inside a light rounded border (no card shadow) so it reads as a
 * continuation prompt, not a second composer card. Below the editor:
 *   - chip list of staged attachments (when any), with per-chip remove
 *   - inline error slot (upload + submit errors share the same surface)
 *
 * Mirrors `ComposerInput.vue` for the attach buttons but keeps the bar
 * visually lighter: a paperclip + an image icon, both flush left of the
 * send button row.
 *
 * `focus()` is exposed for the page-level "focus the follow-up" path
 * (Resume button on the Aborted banner, auto-focus on ABORTED
 * transition). The page would otherwise have to query the DOM for a
 * `[contenteditable]` element nested inside md-editor-v3, which couples
 * the page to library internals.
 */
import { computed, ref } from 'vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import Icon from '@/components/ui/Icon.vue'
import MediaPickerOverlay from '@/components/MediaPickerOverlay.vue'
import { isSubmitKeystroke } from '@/composables/useComposerInput'
import { usePlatform } from '@/composables/usePlatform'
import type { MediaAsset } from '@/types/media'

type ImageSupport = 'loading' | 'active' | 'unsupported'

interface Props {
  showFollowupBar: boolean
  followupPrompt: string
  submittingFollowup: boolean
  /** State-aware placeholder text. ABORTED uses a redirect cue. */
  followupPlaceholder?: string
  /** Attachments staged for the next follow-up submit. */
  attachedMedia: MediaAsset[]
  /** Two-way bound modal visibility for `MediaPickerOverlay`. */
  showMediaPicker: boolean
  /** Picker filter: `image` restricts to vision-LLM types. */
  pickerMediaKind: 'image' | 'image+document'
  /** Picker `accept` attribute — usually the extension list. */
  pickerAccept: string
  /** Tri-state image-support derived from the agent's LLM. */
  imageSupport: ImageSupport
  /**
   * Unified error for the inline error slot. The page composes
   * `uploadError ?? followupError` (see `useTaskChatFollowup.composerError`)
   * so the upload-time guard and the server-side submit error share one
   * surface; the component itself only knows about this single channel.
   */
  composerError: string | null
  /** Agent id used to scope `MediaPickerOverlay` uploads. */
  agentId: number
  /** Agent principal id for principal-scoped media listings. */
  agentPrincipalId?: number | null
}

const props = withDefaults(defineProps<Props>(), {
  followupPlaceholder: 'Ask a follow-up question…',
  agentPrincipalId: null,
})

const emit = defineEmits<{
  updateFollowupPrompt: [value: string]
  submitFollowup: []
  updateShowMediaPicker: [value: boolean]
  updatePickerMediaKind: [value: 'image' | 'image+document']
  pickerAttach: [assets: MediaAsset[]]
  removeAttachment: [id: string]
  /**
   * Emitted when the user clicks an attach button. The page owns the
   * `pickerAccept` (it depends on the dynamic allowlist) and calls
   * `followup.openPicker(kind)` to populate both the kind and the
   * accept before flipping `showMediaPicker`.
   */
  requestOpenPicker: [kind: 'image' | 'image+document']
}>()

const promptModel = computed({
  get: () => props.followupPrompt,
  set: (v: string) => emit('updateFollowupPrompt', v),
})

const showPickerModel = computed({
  get: () => props.showMediaPicker,
  set: (v: boolean) => emit('updateShowMediaPicker', v),
})

const { submitShortcutHint } = usePlatform()

const editorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null)

function isImageAsset(asset: MediaAsset): boolean {
  return (asset.media_type ?? '').toLowerCase() === 'image'
}

function onKeydown(e: KeyboardEvent): void {
  if (isSubmitKeystroke(e)) {
    e.preventDefault()
    emit('submitFollowup')
  }
}

defineExpose({
  focus(): void {
    editorRef.value?.focus()
  },
})

function openPicker(kind: 'image' | 'image+document'): void {
  emit('requestOpenPicker', kind)
}

function imageButtonTitle(): string {
  switch (props.imageSupport) {
    case 'active':
      return 'Attach an image'
    case 'unsupported':
      return 'This LLM does not support image attachments'
    case 'loading':
      return 'Checking image support…'
  }
}
</script>

<template>
  <div
    v-if="showFollowupBar"
    class="border-t border-border bg-background shrink-0"
  >
    <div class="px-4 py-3 max-w-3xl mx-auto w-full">
      <div class="flex flex-col gap-2 px-3 py-2 rounded-xl border border-border bg-background focus-within:ring-2 focus-within:ring-primary/20 transition-all">
        <div class="flex items-end gap-2">
          <div class="flex-1 min-w-0">
            <MarkdownEditor
              ref="editorRef"
              v-model="promptModel"
              mode="bubble"
              :rows="1"
              :auto-grow="true"
              :max-rows="10"
              :disabled="submittingFollowup"
              :placeholder="`${followupPlaceholder} ${submitShortcutHint}`"
              data-testid="followup-input"
              @keydown="onKeydown"
            />
          </div>
          <button
            data-testid="send-followup"
            @click="emit('submitFollowup')"
            :disabled="submittingFollowup || !followupPrompt.trim()"
            class="shrink-0 h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center"
            type="button"
          >
            <Icon name="arrow-right" />
          </button>
        </div>

        <!-- Attachment chips — only when at least one is staged -->
        <div
          v-if="attachedMedia.length > 0"
          class="flex flex-wrap gap-1.5 pt-1"
          data-testid="followup-attachment-chips"
        >
          <span
            v-for="m in attachedMedia"
            :key="m.id"
            class="inline-flex items-center gap-1.5 rounded-full bg-muted pl-1 pr-2 py-0.5 text-xs"
            :title="m.filename ?? m.id"
          >
            <img
              v-if="isImageAsset(m) && m.asset_url"
              :src="m.asset_url"
              :alt="m.filename ?? m.id"
              class="h-5 w-5 rounded-full object-cover"
            />
            <Icon v-else name="file" class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="max-w-[120px] truncate">{{ m.filename ?? m.id.slice(0, 8) }}</span>
            <button
              @click="emit('removeAttachment', m.id)"
              class="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
              :title="`Remove ${m.filename ?? 'attachment'}`"
              data-testid="followup-remove-attachment"
              type="button"
            >
              ×
            </button>
          </span>
        </div>

        <!-- Attach buttons + error -->
        <div class="flex items-center gap-1">
          <button
            type="button"
            @click="openPicker('image+document')"
            :disabled="submittingFollowup"
            class="inline-flex h-7 items-center gap-1 px-2 rounded-md border border-border text-xs font-medium bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
            data-testid="followup-attach-file"
            title="Attach a file"
          >
            <Icon name="paperclip" class="h-3 w-3" />
          </button>
          <button
            type="button"
            @click="openPicker('image')"
            :disabled="submittingFollowup || imageSupport === 'unsupported'"
            :title="imageButtonTitle()"
            class="inline-flex h-7 items-center gap-1 px-2 rounded-md border border-border text-xs font-medium bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
            data-testid="followup-attach-image"
          >
            <Icon name="image" class="h-3 w-3" />
          </button>
        </div>
      </div>
      <p
        v-if="composerError"
        role="alert"
        data-testid="followup-error"
        class="mt-1 text-xs text-destructive"
      >
        {{ composerError }}
      </p>
    </div>

    <MediaPickerOverlay
      v-model="showPickerModel"
      :agent-id="agentId"
      :agent-principal-id="agentPrincipalId"
      :media-kind="pickerMediaKind"
      :accept="pickerAccept"
      @attach="(assets) => emit('pickerAttach', assets)"
    />
  </div>
</template>
