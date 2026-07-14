/**
 * useMarkdownEditorHeight — pure height-clamp helper for the
 * `MarkdownEditor` auto-grow feature.
 */
import { describe, it, expect } from 'vitest'
import { computeAutoGrowHeight } from '@/composables/useMarkdownEditorHeight'

const PADDING = 32 // bubble mode
const LINE = 24

describe('computeAutoGrowHeight', () => {
  it('clamps to the minimum when scrollHeight is below the requested rows', () => {
    const h = computeAutoGrowHeight({
      scrollHeight: 0,
      rows: 1,
      maxRows: 8,
      padding: PADDING,
    })
    expect(h).toBe(1 * LINE + PADDING) // 56
  })

  it('returns scrollHeight verbatim when it is within [min, max]', () => {
    const min = 1 * LINE + PADDING
    const max = 8 * LINE + PADDING
    const h = computeAutoGrowHeight({
      scrollHeight: (min + max) / 2,
      rows: 1,
      maxRows: 8,
      padding: PADDING,
    })
    expect(h).toBe((min + max) / 2)
  })

  it('clamps to the maximum when scrollHeight exceeds maxRows * line + padding', () => {
    const h = computeAutoGrowHeight({
      scrollHeight: 9999,
      rows: 1,
      maxRows: 8,
      padding: PADDING,
    })
    expect(h).toBe(8 * LINE + PADDING) // 224
  })

  it('treats rows=0 as rows=1 for the minimum (never smaller than one line)', () => {
    const h = computeAutoGrowHeight({
      scrollHeight: 0,
      rows: 0,
      maxRows: 8,
      padding: PADDING,
    })
    expect(h).toBe(1 * LINE + PADDING)
  })

  it('respects a custom lineHeight', () => {
    const h = computeAutoGrowHeight({
      scrollHeight: 0,
      rows: 1,
      maxRows: 8,
      padding: 16,
      lineHeight: 20,
    })
    expect(h).toBe(20 + 16)
  })

  it('uses 16px padding (full-mode default) when padding is set explicitly', () => {
    const h = computeAutoGrowHeight({
      scrollHeight: 9999,
      rows: 1,
      maxRows: 12,
      padding: 16,
    })
    expect(h).toBe(12 * LINE + 16) // 304
  })
})
