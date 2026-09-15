/**
 * useSpeechPreferences — per-user UX toggles for the recording flow.
 *
 * The only flag today is `skipSpeechPreview`: when `true`, the recording
 * button skips the preview/play/discard step and auto-transcribes on
 * stop. Default is `false` so the operator gets explicit Transcribe /
 * Send / Discard buttons after each recording — auto-transcribe felt
 * surprising in manual testing (the operator's intended Send vs
 * Transcribe choice was lost).
 *
 * **Storage choice — localStorage, not the server.** This is a UX
 * toggle, not a domain preference. Spora's preference system is narrow
 * (LLM config only — see `llmPreferencesStore`) and expanding it for a
 * single boolean is a backend-side change out of scope for the PR that
 * shipped this. localStorage matches the lifetime of the decision
 * (per-browser) and avoids an extra round-trip on every composer mount.
 */
import { ref, type Ref } from 'vue'

export interface UseSpeechPreferences {
  skipSpeechPreview: Ref<boolean>
  setSkipSpeechPreview(value: boolean): void
  toggleSkipSpeechPreview(): void
}

const STORAGE_KEY = 'spora.speech.skipSpeechPreview.v1'

function readStored(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === null) {
      return false
    }
    return stored === 'true'
  } catch {
    return false
  }
}

function writeStored(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false')
  } catch {
    // Storage unavailable (private browsing, embedded WebView, SSR) —
    // the in-memory ref still reflects the new value for the session.
  }
}

export function useSpeechPreferences(): UseSpeechPreferences {
  const skipSpeechPreview = ref<boolean>(readStored())

  function setSkipSpeechPreview(value: boolean): void {
    // Single source of localStorage writes — explicit, not a watcher.
    // A watcher-based approach skipped writes when the new value
    // matched the existing ref (setSkipSpeechPreview(false) on an
    // already-false ref), so we write eagerly to mirror the call.
    skipSpeechPreview.value = value
    writeStored(value)
  }

  function toggleSkipSpeechPreview(): void {
    setSkipSpeechPreview(!skipSpeechPreview.value)
  }

  return {
    skipSpeechPreview,
    setSkipSpeechPreview,
    toggleSkipSpeechPreview,
  }
}
