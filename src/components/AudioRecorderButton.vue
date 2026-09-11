<script setup lang="ts">
/**
 * AudioRecorderButton — voice input for the prompt composer.
 *
 * State machine (mirrors `useAudioRecorder`):
 *
 *   idle → recording → finalizing → preview → idle (Use emits `recorded`)
 *                                  ↘                ↘ idle (Discard discards blob)
 *                                   error → idle (Try again)
 *
 * MIME negotiation happens inside `useAudioRecorder.pickSupportedMimeType()`.
 * The chosen MIME is forwarded to `/media` so the asset row records the
 * actual container the browser produced.
 *
 * Two paths to commit the recording:
 *
 *   1. **Preview (default)** — record → stop → show audio element with
 *      Use/Discard buttons. The User clicks Use to upload + transcribe
 *      and emit `recorded`. Mirrors WhatsApp voice messages.
 *
 *   2. **Auto-transcribe (`skip_speech_preview` opt-out)** — the Use
 *      step runs immediately after stop, no preview shown. The flag
 *      lives in `useSpeechPreferences` (localStorage-backed, see the
 *      composable for the storage rationale).
 *
 * On success the component emits `recorded` with the uploaded `MediaAsset`
 * AND the transcript text. The parent attaches the asset as a chip
 * (replay available in the chat bubble) and prepends the transcript to
 * the prompt.
 */
import { computed, onMounted, ref } from 'vue'
import { useAudioRecorder } from '@/composables/useAudioRecorder'
import { useSpeechCapability } from '@/composables/useSpeechCapability'
import { useSpeechPreferences } from '@/composables/useSpeechPreferences'
import { ApiError, api, postTranscribeAudio } from '@/api/client'
import Icon from '@/components/ui/Icon.vue'
import type { MediaAsset } from '@/types/media'

const props = withDefaults(defineProps<{
  agentId: number
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  recorded: [payload: { media: MediaAsset, transcript: string }]
  error: [message: string]
}>()

const recorder = useAudioRecorder()
const speech = useSpeechCapability()
const prefs = useSpeechPreferences()

// Uploading/transcribing sub-phase of the preview "Use" path. Stored
// separately from `recorder.state` because the recorder has already
// finished by then — `state` reads `preview` here.
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
      await commitRecording(blob)
    }
  }
}

async function commitRecording(blob: Blob): Promise<void> {
  submitting.value = true
  submitError.value = null
  try {
    const form = new FormData()
    form.append('file', blob, 'recording.webm')
    form.append('agent_id', String(props.agentId))
    const media = await api.postForm<MediaAsset>('/media', form)
    const transcription = await postTranscribeAudio({ media_id: media.id })
    emit('recorded', {
      media,
      transcript: transcription.data.text,
    })
    recorder.discard()
  } catch (e) {
    submitError.value = e instanceof ApiError ? e.message : 'Failed to upload or transcribe the recording.'
  } finally {
    submitting.value = false
  }
}

function onUseClick(): void {
  if (recorder.audioBlob.value === null) {
    return
  }
  void commitRecording(recorder.audioBlob.value)
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
      v-if="recorder.state.value === 'idle'"
      class="inline-flex items-center"
    >
      <button
        type="button"
        :disabled="disabled"
        class="inline-flex h-8 items-center gap-1.5 px-3 rounded-[8px] border border-border text-xs font-medium bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
        title="Record audio"
        data-testid="audio-record-button"
        @click="onRecordClick"
      >
        <Icon
          name="mic"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        />
        <span>Record</span>
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
        class="inline-flex h-8 items-center gap-1.5 px-3 rounded-[8px] border border-destructive text-xs font-medium bg-background text-destructive hover:bg-destructive/10 transition-colors"
        title="Stop recording"
        data-testid="audio-stop-button"
        @click="onRecordClick"
      >
        <Icon
          name="stop-circle"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        />
        <span>Stop</span>
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
        title="Use this recording"
        data-testid="audio-use-button"
        @click="onUseClick"
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
        <span>{{ submitting ? 'Transcribing…' : 'Use' }}</span>
      </button>
      <button
        type="button"
        :disabled="submitting"
        class="inline-flex h-8 items-center gap-1.5 px-2 rounded-[8px] border border-border text-xs font-medium bg-background text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
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
  </div>
</template>
