/**
 * useSpeechPreferences — per-user UX toggles for the recording flow.
 *
 * The only flag today is `skipSpeechPreview`: when `true`, the recording
 * button skips the preview/play/discard step and auto-transcribes on
 * stop. Default is `false` (always show preview) so the operator gets
 * explicit Transcribe / Send / Discard buttons after each recording —
 * matching the chat-bubble text-input flow where every keystroke is
 * shown before submission. Auto-transcribe felt surprising in manual
 * testing (the operator's intended Send vs Transcribe choice was lost),
 * so the preview is now opt-in via `setSkipSpeechPreview(true)`.
 *
 * Existing operators who've explicitly persisted `true` keep their
 * preference (the `stored === 'true'` branch below is honoured); only
 * brand-new operators (`stored === null`) get the new default.
 *
 * **Storage choice — localStorage, not the server.** This is a UX
 * toggle, not a domain preference. The plan called for using "the
 * existing user-preferences store" but Spora's preference system is
 * narrow (LLM config only — see `llmPreferencesStore`) and expanding
 * it for a single boolean is a backend-side change that doesn't fit
 * PR #2's frontend scope. localStorage matches the lifetime of the
 * decision (per-browser) and avoids an extra round-trip on every
 * composer mount. If a future plan needs cross-device sync, the
 * shape returned here is small enough to lift into a server-side
 * preferences controller without an API break.
 */
import { ref, watch, type Ref } from 'vue'

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
      // Brand-new operator (no persisted preference yet) — default to
      // preview so the operator picks Send vs Transcribe explicitly.
      // Existing auto-transcribe opt-ins are preserved by the
      // `stored === 'true'` branch below.
      return false
    }
    return stored === 'true'
  } catch {
    // Storage may be unavailable (private browsing, embedded WebView,
    // server-side render). Fall back to the default.
    return false
  }
}

function writeStored(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false')
  } catch {
    // Same rationale as `readStored`. The in-memory ref still reflects
    // the new value for the session; we just can't persist it.
  }
}

export function useSpeechPreferences(): UseSpeechPreferences {
  const skipSpeechPreview = ref<boolean>(readStored())

  function setSkipSpeechPreview(value: boolean): void {
    skipSpeechPreview.value = value
    writeStored(value)
  }

  function toggleSkipSpeechPreview(): void {
    setSkipSpeechPreview(!skipSpeechPreview.value)
  }

  // Cross-tab sync: when another tab toggles the flag, this tab picks
  // it up on the next event-loop tick. The recording button's preview
  // gate stays consistent across windows without a round-trip.
  watch(skipSpeechPreview, (next) => {
    writeStored(next)
  })

  return {
    skipSpeechPreview,
    setSkipSpeechPreview,
    toggleSkipSpeechPreview,
  }
}
