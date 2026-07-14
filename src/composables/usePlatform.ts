/**
 * usePlatform — detect the user's OS and input modality so keyboard hints
 * (e.g. "Cmd+Enter to submit") can adapt to the platform.
 *
 * - `isMac` — true for macOS, iPadOS, and iOS. Drives whether we show
 *   "Cmd" or "Ctrl" in keyboard hints.
 * - `isMobile` — true for phones and tablets. On touch-primary devices we
 *   suppress keyboard hints entirely, since the user has no Cmd/Ctrl key
 *   to press.
 *
 * Detection runs on every call via `navigator.userAgent`. The platform
 * does not change at runtime, so this is a cheap read; reading on each
 * call also keeps the composable trivial to unit-test by stubbing
 * `navigator.userAgent`.
 */

export interface PlatformInfo {
  isMac: boolean
  isMobile: boolean
  /** "Cmd" on Mac, "Ctrl" elsewhere, "" on mobile. */
  submitShortcutKey: string
  /** Full parenthetical hint, e.g. "(Cmd+Enter to submit)", or "" on mobile. */
  submitShortcutHint: string
}

export function usePlatform(): PlatformInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isMac = /Mac|iPhone|iPad|iPod/i.test(ua)
  // Touch-primary devices: phones, tablets, and any UA that explicitly
  // identifies as mobile. This intentionally errs on the side of hiding
  // keyboard hints on tablets even when a hardware keyboard is attached,
  // because the dominant input is still touch.
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
  const submitShortcutKey = isMobile ? '' : isMac ? 'Cmd' : 'Ctrl'
  const submitShortcutHint = isMobile ? '' : `(${submitShortcutKey}+Enter to submit)`
  return { isMac, isMobile, submitShortcutKey, submitShortcutHint }
}
