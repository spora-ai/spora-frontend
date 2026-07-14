/**
 * useMarkdownEditorHeight — pure height-clamp helper for the
 * `MarkdownEditor` auto-grow feature.
 *
 * Kept side-effect-free (no Vue, no DOM access) so it can be unit-tested
 * without mounting the editor. The runtime watcher that reads the
 * contenteditable's `scrollHeight` lives in `MarkdownEditor.vue`; this
 * module is just the arithmetic.
 *
 * The formula mirrors the existing fixed-height logic in
 * `MarkdownEditor.vue`:
 *   height = max(rows, 1) * lineHeight + padding
 * For auto-grow, we additionally cap at `maxRows * lineHeight + padding`
 * so the box never grows past the requested maximum.
 */

export interface AutoGrowHeightOptions {
  /** Live height of the contenteditable, in pixels. */
  scrollHeight: number
  /** Starting / minimum row count. */
  rows: number
  /** Maximum row count the editor is allowed to grow to. */
  maxRows: number
  /** Internal vertical padding the editor adds around the text. Bubble mode uses 32, full mode 16. */
  padding: number
  /** Single line height in pixels. Defaults to 24 to match `MarkdownEditor`. */
  lineHeight?: number
}

export function computeAutoGrowHeight(options: AutoGrowHeightOptions): number {
  const { scrollHeight, rows, maxRows, padding, lineHeight = 24 } = options
  const min = Math.max(rows, 1) * lineHeight + padding
  const max = maxRows * lineHeight + padding
  return Math.min(Math.max(scrollHeight, min), max)
}
