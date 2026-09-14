<script setup lang="ts">
/**
 * AudioRecorderButton — voice input for the prompt composer.
 *
 * State machine (mirrors `useAudioRecorder`):
 *
 *   idle → recording → finalizing → preview → idle (Transcribe / Transcribe & send emits `recorded`)
 *                                  ↘                ↘ idle (Discard discards blob)
 *                                   error → idle (Try again)
 *
 * MIME negotiation happens inside `useAudioRecorder.pickSupportedMimeType()`.
 * The chosen MIME is forwarded to `/media` so the asset row records the
 * actual container the browser produced.
 *
 * Preview path:
 *
 *   After stop the operator sees two affordances:
 *
 *   - **Transcribe & send** (primary CTA, filled `bg-primary`) — upload +
 *     transcribe in one shot, then emit `recorded` with `mode: 'send'`.
 *     Parent (`useTaskChatFollowup.onAudioRecorded`,
 *     `ComposerInput.onAudioRecorded`) calls its own submit entry point so
 *     the turn fires without another click. Surfaced on every composer
 *     that mounts the recorder.
 *   - **Transcribe** (outlined, secondary) — same pipeline, but emits
 *     `mode: 'use'`. Parent stages just the transcript text in the
 *     prompt; the operator clicks the composer's main Send to add
 *     images or scheduling alongside.
 *   - **Discard** (icon-only) — always rendered. Drops the blob and
 *     returns to idle.
 *
 * Both buttons route through the same `commitRecording` pipeline so
 * transcribe failures surface a toast in either path. The mode
 * discriminator on the emit lets the parent decide whether to
 * auto-submit or stage.
 *
 * Auto-transcribe (`skipSpeechPreview === true`) — preview is skipped
 * entirely and `mode: 'use'` is emitted at the end of `onRecordClick`,
 * mirroring the Transcribe path. The flag lives in
 * `useSpeechPreferences` (localStorage-backed, see the composable for
 * the storage rationale).
 *
 * Wire contract: the recorded audio is uploaded with `is_temporary=true`
 * so the backend's per-(user, agent) retention pipeline
 * (`agents.voice_message_retention_count` + `/media/{id}/keep`) can GC
 * the row. **The temp audio row is NOT attached to the LLM submission
 * — only the transcript text travels to the model.** Operators
 * occasionally saw the model hedge "couldn't extract any text from the
 * attached file" when the row leaked through; parents in this codebase
 * now ignore the `media` field on the `recorded` emit and use just the
 * transcript. The audio chip in the chat bubble (rendered from
 * `entry.attachments[*].media_type === 'audio'`) is similarly absent
 * for voice-driven turns — a deliberate trade-off for a clean prompt.
 *
 * **Disabled state** — when the capability probe reports `canRecord ===
 * false` (no STT provider configured at any scope: global, group, user,
 * or agent), the idle branch renders a "Voice not configured" pill with
 * a "Set up" deep-link instead of the Record button. The link routes to
 * the admin speech-providers page (named route
 * `settings-admin-speech-providers` with `?create=1`) for global admins
 * and the user speech-settings page (`settings-speech` with `?create=1`)
 * for everyone else. The named route + `?create=1` query is the same
 * shape `SpeechProviderConfigsPage` uses to open the create form.
 */
import { computed, onMounted, ref } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import { useAudioRecorder } from '@/composables/useAudioRecorder'
import { useSpeechCapability } from '@/composables/useSpeechCapability'
import { useSpeechPreferences } from '@/composables/useSpeechPreferences'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { ApiError, api, postTranscribeAudio } from '@/api/client'
import Icon from '@/components/ui/Icon.vue'
import type { MediaAsset } from '@/types/media'

const props = withDefaults(defineProps<{
  agentId: number
  disabled?: boolean
  /**
   * Render the idle-state button as an icon-only square (`h-7 w-7`,
   * no text label) instead of the default text pill (`h-8 px-3` with a
   * "Record" label). Use in rows whose neighbours are already
   * icon-only — e.g. the follow-up conversation's attach row — so the
   * mic button matches the rest of the row's affordance density.
   */
  compact?: boolean
}>(), {
  disabled: false,
  compact: false,
})

const emit = defineEmits<{
  recorded: [payload: { media: MediaAsset, transcript: string, mode: 'use' | 'send' }]
  error: [message: string]
}>()

const recorder = useAudioRecorder()
const speech = useSpeechCapability()
const prefs = useSpeechPreferences()
const auth = useAuthStore()
const toast = useToast()

/**
 * The "Set up" deep-link target when the operator (or the user's group /
 * agent override) has no STT config. Admins go straight to the provider
 * admin page; everyone else goes to their user-settings speech page. Both
 * named routes already exist on the main router; `?create=1` opens the
 * create view inside `SpeechProviderConfigsPage`. Returning a route
 * object (not a string) keeps the link in sync with any future router
 * path change.
 */
const setupLink = computed<RouteLocationRaw>(() => auth.user?.is_admin === true
  ? { name: 'settings-admin-speech-providers', query: { create: '1' } }
  : { name: 'settings-speech', query: { create: '1' } })

// Uploading/transcribing sub-phase of either preview path (Send or
// Transcribe). Stored separately from `recorder.state` because the
// recorder has already finished by then — `state` reads `preview` here.
const submitting = ref(false)
const submitError = ref<string | null>(null)

onMounted(() => {
  // Lazy capability probe — only fires on first mount when the
  // component is rendered. The composable's cache serves subsequent
  // mounts; see the composable's docblock for the rationale.
  void speech.refresh()
})

const blobUrl = computed<string | null>(() => {
  if (recorder.audioBlob.value === null) {
    return null
  }
  return URL.createObjectURL(recorder.audioBlob.value)
})

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

async function onRecordClick(): Promise<void> {
  submitError.value = null
  if (recorder.state.value === 'idle') {
    try {
      await recorder.start()
    } catch (e) {
      emit('error', e instanceof Error ? e.message : 'Recording failed.')
    }
    return
  }
  if (recorder.state.value === 'recording') {
    const blob = await recorder.stop()
    if (blob === null) {
      return
    }
    if (prefs.skipSpeechPreview.value) {
      await commitRecording(blob, 'use')
    }
  }
}

async function commitRecording(blob: Blob, mode: 'use' | 'send'): Promise<void> {
  submitting.value = true
  submitError.value = null
  try {
    const form = new FormData()
    form.append('file', blob, 'recording.webm')
    form.append('agent_id', String(props.agentId))
    // Mark the row as GC-eligible: the backend's per-(user, agent)
    // retention count trims these back to the most recent N unless the
    // user / follow-up keeps them via `POST /media/{id}/keep` (the
    // chat-bubble pin affordance). Without this flag the row would be
    // considered permanent, defeating the retention knob on the agent
    // settings page. String cast keeps FormData wire-compatible with
    // Laravel's `boolean` validation rule.
    form.append('is_temporary', 'true')
    const media = await api.postForm<MediaAsset>('/media', form)
    const transcription = await postTranscribeAudio({ media_id: media.id })

    // Refuse to emit when the transcript came back empty — sending a
    // raw audio file to the LLM with no text on top makes the model
    // guess at the bytes (and reply with the "couldn't extract any
    // text" hedge the operator just saw). The audio is already on the
    // server as a temp row, so the retention policy (`media:gc
    // --temporary`) will sweep it. Surface a toast + stay in the
    // preview so the operator can retry the recording or hit Discard.
    const transcript = (transcription.text ?? '').trim()
    if (transcript.length === 0) {
      const message = 'Transcription returned no text — record again or discard the audio.'
      submitError.value = message
      toast.warning(message)
      return
    }

    emit('recorded', {
      media,
      transcript,
      mode,
    })
    recorder.discard()
  } catch (e) {
    // Toast surfaces the failure while the recorder is still in
    // `preview` (the inline `audio-submit-error` chip only renders in
    // `idle`, so without this the user sees no feedback between Use
    // and the next click). `submitError` stays set so the chip still
    // shows once the user discards the preview.
    const message = e instanceof ApiError ? e.message : 'Failed to upload or transcribe the recording.'
    submitError.value = message
    toast.error(message)
  } finally {
    submitting.value = false
  }
}

function onSendClick(): void {
  if (recorder.audioBlob.value === null) {
    return
  }
  void commitRecording(recorder.audioBlob.value, 'send')
}

function onTranscribeClick(): void {
  if (recorder.audioBlob.value === null) {
    return
  }
  void commitRecording(recorder.audioBlob.value, 'use')
}

function onDiscardClick(): void {
  recorder.discard()
  submitError.value = null
}

function onCancelRecording(): void {
  recorder.cancel()
  submitError.value = null
}

function onRetryClick(): void {
  submitError.value = null
  recorder.discard()
}

const showErrorChip = computed(() => submitError.value !== null || recorder.error.value !== null)
const errorMessage = computed(() => submitError.value ?? recorder.error.value?.message ?? '')
</script>

<template>
  <div class="inline-flex flex-col gap-1.5">
    <div
      v-if="recorder.state.value === 'idle' && speech.canRecord.value"
      class="inline-flex items-center"
    >
      <button
        type="button"
        :disabled="disabled"
        :class="compact
          ? 'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none'
          : 'inline-flex h-8 items-center gap-1.5 px-3 rounded-[8px] border border-border text-xs font-medium bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none'"
        title="Record audio"
        :aria-label="compact ? 'Record audio' : undefined"
        data-testid="audio-record-button"
        @click="onRecordClick"
      >
        <Icon
          :class="compact ? 'h-3 w-3' : 'h-3.5 w-3.5'"
          name="mic"
          aria-hidden="true"
        />
        <span v-if="!compact">Record</span>
      </button>
    </div>

    <div
      v-else-if="recorder.state.value === 'recording'"
      class="inline-flex items-center gap-2"
    >
      <span
        class="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse"
        aria-hidden="true"
      />
      <span
        class="text-xs font-mono tabular-nums text-destructive"
        data-testid="audio-recorder-timer"
      >
        {{ formatElapsed(recorder.elapsedMs.value) }}
      </span>
      <button
        type="button"
        class="inline-flex h-8 items-center gap-1.5 px-3 rounded-[8px] border border-primary text-xs font-medium bg-background text-primary hover:bg-primary/10 transition-colors"
        title="Recording is ready — transcribe and send, or just transcribe"
        data-testid="audio-stop-button"
        @click="onRecordClick"
      >
        <Icon
          name="check-circle"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        />
        <span>Ready</span>
      </button>
      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-border text-xs font-medium bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title="Cancel recording"
        data-testid="audio-cancel-button"
        @click="onCancelRecording"
      >
        <Icon
          name="x"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        />
      </button>
    </div>

    <div
      v-else-if="recorder.state.value === 'finalizing'"
      class="inline-flex items-center gap-2"
    >
      <Icon
        name="loader-2"
        class="h-3.5 w-3.5 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
      <span class="text-xs text-muted-foreground">Finalising…</span>
    </div>

    <div
      v-else-if="recorder.state.value === 'preview' && blobUrl !== null"
      class="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-2 py-1.5"
      data-testid="audio-preview"
    >
      <audio
        :src="blobUrl"
        controls
        class="h-8 max-w-[240px]"
      />
      <button
        type="button"
        :disabled="submitting"
        class="inline-flex h-8 items-center gap-1.5 px-3 rounded-[8px] border border-transparent text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-colors"
        title="Transcribe the audio and send the transcript immediately"
        data-testid="audio-transcribe-and-send-button"
        @click="onSendClick"
      >
        <Icon
          v-if="!submitting"
          name="arrow-right"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        />
        <Icon
          v-else
          name="loader-2"
          class="h-3.5 w-3.5 animate-spin"
          aria-hidden="true"
        />
        <span>{{ submitting ? 'Transcribing…' : 'Transcribe & send' }}</span>
      </button>
      <button
        type="button"
        :disabled="submitting"
        class="inline-flex h-8 items-center gap-1.5 px-3 rounded-[8px] border border-border text-xs font-medium bg-background text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
        title="Transcribe only — keep the prompt staged for review"
        data-testid="audio-transcribe-button"
        @click="onTranscribeClick"
      >
        <Icon
          v-if="!submitting"
          name="check"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        />
        <Icon
          v-else
          name="loader-2"
          class="h-3.5 w-3.5 animate-spin"
          aria-hidden="true"
        />
        <span>{{ submitting ? 'Transcribing…' : 'Transcribe' }}</span>
      </button>
      <button
        type="button"
        :disabled="submitting"
        class="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-border text-xs font-medium bg-background text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
        title="Discard recording"
        data-testid="audio-discard-button"
        @click="onDiscardClick"
      >
        <Icon
          name="trash"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        />
      </button>
    </div>

    <div
      v-else-if="recorder.state.value === 'error'"
      class="inline-flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2 py-1.5"
      data-testid="audio-error-state"
    >
      <Icon
        name="mic-off"
        class="h-3.5 w-3.5 text-destructive"
        aria-hidden="true"
      />
      <span class="text-xs text-destructive">{{ errorMessage }}</span>
      <button
        type="button"
        class="inline-flex h-7 items-center px-2 rounded-[8px] border border-border text-xs font-medium bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title="Try again"
        data-testid="audio-retry-button"
        @click="onRetryClick"
      >
        Try again
      </button>
    </div>

    <p
      v-if="recorder.state.value === 'idle' && showErrorChip"
      role="alert"
      class="text-xs text-destructive"
      data-testid="audio-submit-error"
    >
      {{ errorMessage }}
    </p>

    <div
      v-if="recorder.state.value === 'idle' && !speech.canRecord.value"
      class="inline-flex h-8 items-center gap-1.5 px-3 rounded-[8px] border border-border bg-background text-xs text-muted-foreground"
      aria-label="Voice input is not configured for this operator"
      data-testid="audio-disabled-state"
    >
      <Icon
        name="mic-off"
        class="h-3.5 w-3.5 opacity-50"
        aria-hidden="true"
      />
      <span>Voice not configured</span>
      <RouterLink
        :to="setupLink"
        class="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary rounded-sm"
        data-testid="audio-setup-link"
      >
        Set up
      </RouterLink>
    </div>
  </div>
</template>
