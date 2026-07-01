/**
 * copyCode — global click handler that copies code blocks to the clipboard.
 *
 * The module attaches a single `click` listener to `document` on import.
 * We mock `navigator.clipboard.writeText` LOCALLY (the coordinator owns
 * adding clipboard to setup.ts), then dispatch synthetic clicks against
 * a code-block fixture and verify the listener behaved correctly.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'

const writeTextMock = vi.fn().mockResolvedValue(undefined)

beforeAll(() => {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writeTextMock },
  })
})

// Import once so the listener is attached
beforeAll(async () => {
  await import('@/copyCode')
})

function makeCodeBlock(code: string): HTMLElement {
  const block = document.createElement('div')
  block.className = 'code-block'
  block.dataset.code = encodeURIComponent(code)
  block.innerHTML = `
    <div class="code-block-header">
      <span class="code-block-lang">js</span>
      <span class="code-block-copy">
        <svg class="code-block-copy-icon"></svg>Copy
      </span>
    </div>
    <pre><code>${code}</code></pre>
  `
  document.body.appendChild(block)
  return block
}

describe('copyCode click handler', () => {
  beforeEach(() => {
    writeTextMock.mockReset().mockResolvedValue(undefined)
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('copies the decoded code content when the copy button is clicked', async () => {
    const block = makeCodeBlock('console.log("hi")')
    const btn = block.querySelector('.code-block-copy') as HTMLElement

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // Wait for the click handler's async writeText() promise
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(writeTextMock).toHaveBeenCalledWith('console.log("hi")')
  })

  it('does nothing when click target is not inside a copy button', () => {
    const block = makeCodeBlock('hello')
    const codeEl = block.querySelector('code') as HTMLElement

    codeEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(writeTextMock).not.toHaveBeenCalled()
  })

  it('does nothing when the code-block has no data-code', () => {
    const block = document.createElement('div')
    block.className = 'code-block'
    block.innerHTML = `<span class="code-block-copy">Copy</span>`
    document.body.appendChild(block)
    const btn = block.querySelector('.code-block-copy') as HTMLElement

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(writeTextMock).not.toHaveBeenCalled()
  })

  it('falls back to "Failed" label when writeText rejects', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('no clipboard'))
    const block = makeCodeBlock('boom')
    const btn = block.querySelector('.code-block-copy') as HTMLElement

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // Wait for the promise chain to flush
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(btn.textContent).toContain('Failed')
  })

  it('restores the icon after the 2-second success reset timer fires', async () => {
    vi.useFakeTimers()
    try {
      const block = makeCodeBlock('echo')
      const btn = block.querySelector('.code-block-copy') as HTMLElement

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      // Flush the click handler's promise chain.
      await vi.advanceTimersByTimeAsync(0)

      expect(btn.textContent).toContain('Copied!')

      // Fast-forward past the 2000 ms reset timer.
      await vi.advanceTimersByTimeAsync(2100)

      // After reset: text is back to the original "Copy" label and the
      // icon node was re-cloned, not re-parsed via innerHTML.
      expect(btn.textContent).toContain('Copy')
      expect(btn.textContent).not.toContain('Copied!')
      expect(btn.querySelector('.code-block-copy-icon')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores the icon after the 2-second failure reset timer fires', async () => {
    vi.useFakeTimers()
    try {
      writeTextMock.mockRejectedValueOnce(new Error('clipboard denied'))
      const block = makeCodeBlock('echo')
      const btn = block.querySelector('.code-block-copy') as HTMLElement

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(0)

      expect(btn.textContent).toContain('Failed')

      await vi.advanceTimersByTimeAsync(2100)

      expect(btn.textContent).toContain('Copy')
      expect(btn.textContent).not.toContain('Failed')
    } finally {
      vi.useRealTimers()
    }
  })
})
