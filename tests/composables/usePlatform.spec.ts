/**
 * usePlatform — platform/mobile detection that drives keyboard hints.
 *
 * The composable reads `navigator.userAgent` on every call, so each test
 * stubs it before invoking `usePlatform()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePlatform } from '@/composables/usePlatform'

const setUserAgent = (ua: string): void => {
  vi.stubGlobal('navigator', { userAgent: ua })
}

describe('usePlatform', () => {
  beforeEach(() => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('detects macOS and shows the Cmd hint', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    const p = usePlatform()
    expect(p.isMac).toBe(true)
    expect(p.isMobile).toBe(false)
    expect(p.submitShortcutKey).toBe('Cmd')
    expect(p.submitShortcutHint).toBe('(Cmd+Enter to submit)')
  })

  it('detects Windows and shows the Ctrl hint', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    const p = usePlatform()
    expect(p.isMac).toBe(false)
    expect(p.isMobile).toBe(false)
    expect(p.submitShortcutKey).toBe('Ctrl')
    expect(p.submitShortcutHint).toBe('(Ctrl+Enter to submit)')
  })

  it('detects Linux and shows the Ctrl hint', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64)')
    const p = usePlatform()
    expect(p.isMac).toBe(false)
    expect(p.isMobile).toBe(false)
    expect(p.submitShortcutKey).toBe('Ctrl')
  })

  it('suppresses the hint on iPhone (mobile)', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
    const p = usePlatform()
    expect(p.isMac).toBe(true) // iPhone matches the Mac regex
    expect(p.isMobile).toBe(true)
    expect(p.submitShortcutKey).toBe('')
    expect(p.submitShortcutHint).toBe('')
  })

  it('suppresses the hint on iPad (mobile)', () => {
    setUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')
    const p = usePlatform()
    expect(p.isMobile).toBe(true)
    expect(p.submitShortcutHint).toBe('')
  })

  it('suppresses the hint on Android (mobile)', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8)')
    const p = usePlatform()
    expect(p.isMac).toBe(false)
    expect(p.isMobile).toBe(true)
    expect(p.submitShortcutHint).toBe('')
  })

  it('falls back to empty strings when navigator is unavailable (SSR-safe)', () => {
    vi.stubGlobal('navigator', undefined)
    const p = usePlatform()
    expect(p.isMac).toBe(false)
    expect(p.isMobile).toBe(false)
    expect(p.submitShortcutKey).toBe('Ctrl')
    expect(p.submitShortcutHint).toBe('(Ctrl+Enter to submit)')
  })
})
