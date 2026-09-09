/**
 * Auto-clearing "flash" ref for transient success messages ("Saved",
 * "Email sent", etc.) that should disappear after a few seconds.
 *
 * Each call returns a fresh `Ref<boolean>` plus `show`/`hide` helpers
 * bound to that specific flag. The internal timer is cleared on every
 * new `show`, on `hide`, and on the consuming component's unmount,
 * so navigation away from the page mid-flush doesn't leave a stale
 * timer pointing at a dead component.
 *
 * Usage:
 *   const displayNameSuccess = useFlashFlag()
 *   await saveDisplayName()
 *   displayNameSuccess.show()       // → true for 3 s, then false
 *   displayNameSuccess.show(5000)   // custom duration
 *   displayNameSuccess.hide()       // dismiss early
 *
 * The returned `value` is a top-level ref so templates auto-unwrap it:
 * `<output v-if="displayNameSuccess.value">…</output>` (or `v-if="flag"`
 * after destructuring).
 */
import { onUnmounted, ref } from 'vue'

export interface FlashFlag {
  readonly value: import('vue').Ref<boolean>
  show: (durationMs?: number) => void
  hide: () => void
}

const DEFAULT_DURATION_MS = 3000

export function useFlashFlag(initial: boolean = false, defaultDurationMs: number = DEFAULT_DURATION_MS): FlashFlag {
  const flag = ref(initial)
  let timer: ReturnType<typeof setTimeout> | null = null

  function clear(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function show(durationMs: number = defaultDurationMs): void {
    clear()
    flag.value = true
    timer = setTimeout(() => {
      timer = null
      flag.value = false
    }, durationMs)
  }

  function hide(): void {
    clear()
    flag.value = false
  }

  onUnmounted(clear)

  return { value: flag, show, hide }
}
