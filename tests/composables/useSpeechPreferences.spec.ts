/**
 * useSpeechPreferences — per-user UX toggles for the recording flow.
 *
 * The composable reads `skipSpeechPreview` from localStorage on init
 * and writes back on every change. The default is `true` (auto-
 * transcribe) so new operators get one-shot voice submission without
 * discovering the preview step — existing operators keep whichever
 * value they've persisted.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { useSpeechPreferences } from '@/composables/useSpeechPreferences'

const STORAGE_KEY = 'spora.speech.skipSpeechPreview.v1'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('useSpeechPreferences', () => {
  it('defaults skipSpeechPreview to false on a fresh storage (always show preview)', () => {
    // Brand-new operators get the explicit Transcribe / Send / Discard
    // buttons after each recording. Existing operators who opted into
    // auto-transcribe (storage === 'true') keep their preference.
    const prefs = useSpeechPreferences()
    expect(prefs.skipSpeechPreview.value).toBe(false)
  })

  it('reads a previously persisted true value', () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    const prefs = useSpeechPreferences()
    expect(prefs.skipSpeechPreview.value).toBe(true)
  })

  it('treats any stored value other than "true" as false', () => {
    localStorage.setItem(STORAGE_KEY, 'yes')
    const prefs = useSpeechPreferences()
    expect(prefs.skipSpeechPreview.value).toBe(false)
  })

  it('persists a true toggle to localStorage', () => {
    const prefs = useSpeechPreferences()
    prefs.setSkipSpeechPreview(true)
    expect(prefs.skipSpeechPreview.value).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  it('persists a false toggle (opt back into the preview step)', () => {
    const prefs = useSpeechPreferences()
    prefs.setSkipSpeechPreview(false)
    expect(prefs.skipSpeechPreview.value).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false')
  })

  it('toggleSkipSpeechPreview inverts the current value', () => {
    const prefs = useSpeechPreferences()
    expect(prefs.skipSpeechPreview.value).toBe(false)
    prefs.toggleSkipSpeechPreview()
    expect(prefs.skipSpeechPreview.value).toBe(true)
    prefs.toggleSkipSpeechPreview()
    expect(prefs.skipSpeechPreview.value).toBe(false)
  })
})
