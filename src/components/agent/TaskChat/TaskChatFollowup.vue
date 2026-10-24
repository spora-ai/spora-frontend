<script setup lang="ts">
/**
 * TaskChatFollowup — the bottom follow-up input bar, shown when the task is
 * COMPLETED, FAILED or ABORTED and the agent allows continuation. Presentational
 * only: `useTaskChatFollowup` owns the state and passes values + handlers in.
 *
 * Mirrors `ComposerInput.vue` but keeps the bar lighter — the attach buttons sit
 * below the editor rather than beside the send button, so the compose affordance
 * stays a single-line input.
 *
 * `focus()` is exposed so the page can focus the editor (Resume button,
 * auto-focus on ABORTED) without querying into md-editor-v3's
 * `[contenteditable]`.
 */
import { computed, ref } from 'vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import { Icon } from '@spora-ai/components/icons'
import MediaPickerOverlay from '@/components/MediaPickerOverlay.vue'
import AudioRecorderButton from '@/components/AudioRecorderButton.vue'
import CommandMenu from '@/components/ui/CommandMenu.vue'
import type { CommandAction } from '@/components/ui/CommandMenu.vue'
import { isSubmitKeystroke } from '@/composables/useComposerInput'
import { usePlatform } from '@/composables/usePlatform'
import type { MediaAsset } from '@/types/media'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

type ImageSupport = 'loading' | 'active' | 'unsupported'

interface Props {
  showFollowupBar: boolean
  followupPrompt: string
  submittingFollowup: boolean
  /** State-aware placeholder text. ABORTED uses a redirect cue. */
  followupPlaceholder: string
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
  /** Tooltip text for the Attach image button — sourced from
   *  `useTaskChatFollowup.imageButtonTitle` so the page owns the state-dependent
   *  copy in one place. */
  imageButtonTitle: string
  /**
   * Unified error for the inline slot. The page composes
   * `uploadError ?? followupError` so upload-time and server-side errors share
   * one surface.
   */
  composerError: string | null
  /** Agent id used to scope `MediaPickerOverlay` uploads. */
  agentId: number
  /** Agent principal id for principal-scoped media listings. */
  agentPrincipalId?: number | null
  /**
   * Commands on the conversation itself — "compact this conversation" and
   * the like. They are not things one types, so they get a menu rather than
   * a place in the prompt.
   */
  commands?: CommandAction[]
  /**
   * A compaction is running. The composer stands down for it: the request
   * rewrites the history the prompt would be appended to, and the call takes
   * a model round trip.
   */
  compacting?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  agentPrincipalId: null,
  commands: () => [],
  compacting: false,
})

const emit = defineEmits<{
  updateFollowupPrompt: [value: string]
  submitFollowup: []
  updateShowMediaPicker: [value: boolean]
  updatePickerMediaKind: [value: 'image' | 'image+document']
  pickerAttach: [assets: MediaAsset[]]
  removeAttachment: [id: string]
  /**
   * Emitted on an attach-button click. The page owns `pickerAccept` (it depends
   * on the dynamic allowlist) and calls `followup.openPicker(kind)` before
   * flipping `showMediaPicker`.
   */
  requestOpenPicker: [kind: 'image' | 'image+document']
  /** Recording finished — page wires to `useTaskChatFollowup.onAudioRecorded`. */
  audioRecorded: [payload: { media: MediaAsset, transcript: string, mode: 'use' | 'send' }]
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
</script>

<template>
  <div
    v-if="showFollowupBar"
    class="border-t border-border bg-background shrink-0"
  >
    <div class="px-4 py-3 max-w-3xl mx-auto w-full">
      <div class="flex flex-col gap-2 px-3 py-2 rounded-xl border border-border bg-background focus-within:ring-2 focus-within:ring-primary/20 transition-all">
        <!--
          A compaction rewrites the history the prompt would be appended to,
          so the composer stands down while it runs. The notice replaces the
          input rather than disabling it: the call takes a model round trip,
          and a greyed-out field would read as a broken one.
        -->
        <output
          v-if="compacting"
          class="flex items-center gap-2 py-2 text-sm text-muted-foreground"
          data-testid="followup-compacting"
          aria-live="polite"
        >
          <Icon
            name="loader-2"
            class="h-4 w-4 shrink-0 animate-spin"
            aria-hidden="true"
          />
          <span>{{ t('Compacting the conversation…') }}</span>
        </output>
        <div
          v-else
          class="flex items-end gap-2"
        >
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
            <Icon
              name="arrow-right"
              aria-hidden="true"
            />
          </button>
        </div>


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
            >
            <Icon
              v-else
              name="file"
              class="h-3.5 w-3.5 text-muted-foreground"
            />
            <span class="max-w-[120px] truncate">{{ m.filename ?? m.id.slice(0, 8) }}</span>
            <button
              @click="emit('removeAttachment', m.id)"
              class="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
              :title="t('Remove {name}', { name: m.filename ?? t('attachment') })"
              data-testid="followup-remove-attachment"
              type="button"
            >
              ×
            </button>
          </span>
        </div>


        <div class="flex items-center gap-1">
          <button
            type="button"
            @click="openPicker('image+document')"
            :disabled="submittingFollowup"
            class="inline-flex h-7 items-center gap-1 px-2 rounded-md border border-border text-xs font-medium bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
            data-testid="followup-attach-file"
            :title="t('Attach a file')"
          >
            <Icon
              name="paperclip"
              class="h-3 w-3"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            @click="openPicker('image')"
            :disabled="submittingFollowup || imageSupport === 'unsupported'"
            :title="imageButtonTitle"
            class="inline-flex h-7 items-center gap-1 px-2 rounded-md border border-border text-xs font-medium bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
            data-testid="followup-attach-image"
          >
            <Icon
              name="image"
              class="h-3 w-3"
              aria-hidden="true"
            />
          </button>
          <AudioRecorderButton
            :agent-id="agentId"
            :disabled="submittingFollowup"
            compact
            @recorded="(payload) => emit('audioRecorded', payload)"
          />
          <CommandMenu
            v-if="commands.length > 0"
            :actions="commands"
            direction="up"
            :disabled="compacting"
            :aria-label="t('Commands')"
          />
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
