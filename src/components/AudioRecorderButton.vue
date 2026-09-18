<script setup lang="ts">
/**
 * AudioRecorderButton — voice input for the prompt composer.
 *
 * State machine (mirrors `useAudioRecorder`):
 *
 *   idle → recording → finalizing → preview → idle (Transcribe / Transcribe & send emits `recorded`)
 *                                  ↘ idle          ↘ idle (Discard discards blob)
 *                                   error → idle (Try again)
 *
 * Preview path offers Transcribe & send (auto-submit), Transcribe (stage
 * only), and Discard. All three exit through the same `commitRecording`
 * upload + transcribe pipeline; the `mode` on `recorded` is the only
 * difference between the two CTAs.
 *
 * With `skipSpeechPreview === true` the preview is skipped and `mode:
 * 'use'` is emitted at the end of recording. The recorded audio is
 * uploaded with `is_temporary=true` so the agent's retention policy
 * (`agents.voice_message_retention_count` + `/media/{id}/keep`) can GC
 * it; only the transcript text is forwarded to the LLM (parents ignore
 * the `media` field on the emit) — sending the audio blob through would
 * make the model guess at the bytes.
 *
 * **Disabled state** — when `canRecord === false` (no STT provider
 * configured at the agent's principal scope: global, group, user, or
 * agent), the idle branch swaps the Record button for a passive
 * "Voice not configured" pill (mic-off icon + label only). Operators
 * go to settings themselves via the existing global navigation when
 * they want to set one up. Compact mode swaps the pill for a muted
 * `mic-off` icon to match the neighbouring icon-only buttons.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAudioRecorder } from '@/composables/useAudioRecorder'
import { useSpeechCapability } from '@/composables/useSpeechCapability'
import { useSpeechPreferences } from '@/composables/useSpeechPreferences'
import { useToast } from '@/composables/useToast'
import { ApiError, api, postTranscribeAudio } from '@/api/client'
import Icon from '@/components/ui/Icon.vue'
import type { MediaAsset } from '@/types/media'

const props = withDefaults(defineProps<{
  agentId: number
  disabled?: boolean
  // Icon-only square (`h-7 w-7`) instead of the text pill. Use in
  // rows whose neighbours are already icon-only — e.g. the
  // follow-up conversation's attach row.
  compact?: boolean
}>(), {
  disabled: false,
  compact: false,
})

const emit = defineEmits<{
  recorded: [payload: { media: MediaAsset, transcript: string, mode: 'use' | 'send' }]
  error: [message: string]
}>()

const speech = useSpeechCapability()

// Pick the resolved provider's MIME list by matching its FQCN against
// the cascade's `effective_class`. Before spora-core#243 the row's own
// `class` field didn't exist, so the picker had to use `providers[0]`
// and inherit the OpenAI-compatible core's WebM-first list even when
// the cascade resolved a plugin (e.g. MiniMax) that prefers OGG/Opus.
// `null` here means "probe hasn't landed yet" — `useAudioRecorder`
// re-evaluates on every `start()` so the next click picks the right
// list once the probe returns.
const preferredAudioMimes = computed<readonly string[] | null>(() => {
  if (speech.effectiveClass.value === null) {
    return null
  }
  const resolved = speech.effectiveClass.value
  const match = speech.state.value.providers.find(
    (provider) => provider.class === resolved,
  )
  return match?.preferred_audio_mimes ?? null
})

const recorder = useAudioRecorder({ preferredMimes: preferredAudioMimes })
const prefs = useSpeechPreferences()
const toast = useToast()

// Sub-phase of the preview path (upload + transcribe). Tracked
// separately from `recorder.state` because the recorder has already
// finished by then — `state` reads `preview` here.
const submitting = ref(false)
const submitError = ref<string | null>(null)

onMounted(() => {
  // Agent-scoped cascade: pass `props.agentId` so the call resolves
  // `?agent_id=N` and the cascade evaluates the agent's principal
  // (user vs. group). Without it the call falls back to caller-scoped
  // resolution, which can pick up the caller's own principal preference
  // and report `configured=true` even when the agent has no usable
  // config — leaving the Record button active against an agent that
  // cannot actually transcribe.
  void speech.refresh(props.agentId)
})

// Re-fetch when navigating between agents without unmounting the
// component (e.g. a route child layout that keeps the parent in
// place across `:id` changes). Without this, the module-level
// `speech.state` cache carries the previous agent's resolution
// across the navigation and the Record / pill state lags.
watch(() => props.agentId, (next) => {
  void speech.refresh(next)
})

// `URL.createObjectURL` allocates native resources that the browser
// only releases on explicit `revokeObjectURL` or page unload.
const blobUrl = ref<string | null>(null)

watch(
  () => recorder.audioBlob.value,
  (next) => {
    // Revoke the prior URL before allocating the next so the browser
    // can free the underlying blob.
    if (blobUrl.value !== null) {
      URL.revokeObjectURL(blobUrl.value)
    }
    blobUrl.value = next === null ? null : URL.createObjectURL(next)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (blobUrl.value !== null) {
    URL.revokeObjectURL(blobUrl.value)
    blobUrl.value = null
  }
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
    // The backend retention policy (`agents.voice_message_retention_count`
    // + `media:gc --temporary`) trims these rows back to the most recent
    // N per (user, agent); setting `is_temporary=true` opts the row into
    // that pool. Without it the row is permanent, defeating the agent
    // settings knob. String cast keeps FormData wire-compatible with
    // Laravel's `boolean` validation rule.
    form.append('is_temporary', 'true')
    const media = await api.postForm<MediaAsset>('/media', form)
    const transcription = await postTranscribeAudio({ media_id: media.id })

    // Sending a raw audio file to the LLM with no transcript text on top
    // makes the model guess at the bytes and reply with the "couldn't
    // extract any text" hedge. The audio is already a temp row on the
    // server so retention will sweep it.
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
    // The inline `audio-submit-error` chip only renders in `idle`, so
    // while the recorder is still in `preview` the toast is the only
    // signal between Use and the next click. `submitError` stays set so
    // the chip still shows after the operator discards the preview.
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
      v-if="recorder.state.value === 'idle' && !speech.canRecord.value && !compact"
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
    </div>

    <div
      v-else-if="recorder.state.value === 'idle' && !speech.canRecord.value && compact"
      class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground opacity-50"
      aria-label="Voice input is not configured for this operator"
      title="Voice not configured"
      data-testid="audio-disabled-state"
    >
      <Icon
        name="mic-off"
        class="h-3 w-3"
        aria-hidden="true"
      />
    </div>
  </div>
</template>
