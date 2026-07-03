/**
 * useMarkdown — tests for the markdown renderer.
 *
 * Verifies:
 *  - Plain markdown becomes HTML
 *  - Code blocks include language label and code-block wrapper
 *  - Sanitizer strips dangerous protocols and scripts
 */
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '@/composables/useMarkdown'

describe('renderMarkdown', () => {
  it('renders basic paragraphs', () => {
    const html = renderMarkdown('Hello **world**')
    expect(html).toContain('<p>')
    expect(html).toContain('<strong>world</strong>')
  })

  it('renders headings', () => {
    const html = renderMarkdown('# Title\n\n## Sub')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<h2>Sub</h2>')
  })

  it('renders fenced code blocks with the code-block wrapper', () => {
    const html = renderMarkdown('```js\nconsole.log("hi")\n```')
    expect(html).toContain('class="code-block"')
    expect(html).toContain('data-code=')
    expect(html).toContain('code-block-lang')
  })

  it('still produces a code-block wrapper when no language is set', () => {
    const html = renderMarkdown('```\nplain\n```')
    expect(html).toContain('code-block-lang')
    expect(html).toContain('plain')
    expect(html).toContain('class="code-block"')
  })

  it('includes the copy button placeholder rewritten to copy button', () => {
    const html = renderMarkdown('```ts\nconst x = 1\n```')
    expect(html).toContain('code-block-copy')
    expect(html).toContain('Copy')
  })

  it('falls back to default code styling when language is unknown', () => {
    const html = renderMarkdown('```someweirdlang\nhello\n```')
    expect(html).toContain('class="code-block"')
    // Unknown language — no language-* class
    expect(html).toContain('hello')
  })

  it('returns sanitized HTML — strips <script> tags', () => {
    const html = renderMarkdown('Hi <script>alert(1)</script>')
    expect(html).not.toContain('<script>')
  })

  it('strips javascript: URLs from anchor tags', () => {
    const html = renderMarkdown('[click](javascript:alert(1))')
    expect(html).not.toMatch(/href="javascript:/i)
  })

  it('preserves http and https links', () => {
    const html = renderMarkdown('[click](https://example.com)')
    expect(html).toContain('href="https://example.com"')
  })

  it('handles empty string input', () => {
    expect(renderMarkdown('')).toBe('')
  })

  it('accepts a missing argument via the default parameter (SonarQube S7760)', () => {
    // Replaces the previous `const raw = src ?? ''` reassignment with a true
    // default parameter. The behaviour must be identical for the empty case.
    expect(renderMarkdown()).toBe('')
  })

  it('renders unordered and ordered lists', () => {
    const html = renderMarkdown('- a\n- b\n\n1. one\n2. two')
    expect(html).toContain('<ul>')
    expect(html).toContain('<ol>')
  })

  it('renders inline code', () => {
    const html = renderMarkdown('Use `inline` code.')
    expect(html).toContain('<code>inline</code>')
  })

  // ── Plugin-generated media (spora-core MediaEmbed) ─────────────────────

  it('preserves <img src=…> for plugin-generated images', () => {
    const html = renderMarkdown('![Generated image](https://cdn.example/x.png)')
    expect(html).toContain('<img')
    expect(html).toContain('src="https://cdn.example/x.png"')
  })

  it('preserves <audio controls src=…> for plugin-generated audio', () => {
    // MediaEmbed::audioFromUrl() emits exactly this markup.
    const html = renderMarkdown('<audio controls preload="metadata" src="https://cdn.example/speech.mp3"></audio>')
    expect(html).toContain('<audio')
    expect(html).toContain('controls')
    expect(html).toContain('preload="metadata"')
    expect(html).toContain('src="https://cdn.example/speech.mp3"')
  })

  it('preserves <video controls src=…> for plugin-generated video', () => {
    const html = renderMarkdown('<video controls preload="metadata" playsinline src="https://cdn.example/clip.mp4"></video>')
    expect(html).toContain('<video')
    expect(html).toContain('controls')
    expect(html).toContain('playsinline')
    expect(html).toContain('src="https://cdn.example/clip.mp4"')
  })

  it('preserves data: URIs on media element src via the installed DOMPurify hook', () => {
    // MediaEmbed::audioFromBytes() / videoFromBytes() emit data: URLs.
    const html = renderMarkdown('<audio controls src="data:audio/mpeg;base64,SUQz"></audio>')
    expect(html).toContain('<audio')
    expect(html).toContain('src="data:audio/mpeg;base64,SUQz"')
  })

  it('preserves width/height on <video>', () => {
    const html = renderMarkdown('<video controls width="1920" height="1080" src="https://cdn.example/v.mp4"></video>')
    expect(html).toContain('width="1920"')
    expect(html).toContain('height="1080"')
  })

  it('strips data:text/html from <a href> (XSS guard)', () => {
    const html = renderMarkdown('[click](data:text/html,<script>alert(1)</script>)')
    expect(html).not.toMatch(/data:text\/html/i)
    // The link may either be removed entirely or kept with a safe href —
    // either way the dangerous payload must not survive.
    expect(html).not.toContain('<script>')
  })

  it('strips javascript: URLs from media src if a malicious actor tries', () => {
    // ALLOWED_URI_REGEXP still blocks javascript: even for media elements.
    const html = renderMarkdown('<audio controls src="javascript:alert(1)"></audio>')
    expect(html).not.toMatch(/src="javascript:/i)
  })

  it('strips data: URIs from <img src>', () => {
    // Only media elements (audio/video/source) get the data: exception;
    // <img> is still governed by the strict ALLOWED_URI_REGEXP.
    const html = renderMarkdown('<img src="data:image/png;base64,AAA" alt="x">')
    expect(html).not.toContain('src="data:image/png')
  })

  it('strips case-insensitive URI schemes (javascript: / JaVaScRiPt:, data: / DaTa:)', () => {
    // RFC 3986 §3.1: schemes are ASCII case-insensitive. A bare
    // regex with /^(?!javascript:|data:)/ without the `i` flag would
    // miss these. Both must be stripped.
    const jsHtml = renderMarkdown('<a href="JaVaScRiPt:alert(1)">x</a>')
    expect(jsHtml).not.toMatch(/href="JaVaScRiPt:/i)

    const imgHtml = renderMarkdown('<img src="DaTa:image/png;base64,AAA" alt="x">')
    expect(imgHtml).not.toMatch(/src="DaTa:/i)
  })

  it('keeps data: blocked on non-media attributes across calls (hook stays installed)', () => {
    // The hook is installed once on the private singleton and never
    // removed, so subsequent renderings still benefit from it.
    // Render an audio data: URL once (hook must allow it).
    const audioHtml = renderMarkdown('<audio controls src="data:audio/mpeg;base64,AAAA"></audio>')
    expect(audioHtml).toContain('src="data:audio/mpeg;base64,AAAA"')

    // Subsequent renderings should still see data: URIs blocked on <a href>.
    const linkHtml = renderMarkdown('[click](data:text/html,<script>x</script>)')
    expect(linkHtml).not.toMatch(/data:text\/html/i)
  })

  it('uses an isolated DOMPurify instance — does not affect a fresh sanitizer', async () => {
    // Our hook DENIES `data:` on `<img>`. DOMPurify without the hook allows
    // it. If our hook leaked onto a fresh instance, this assertion would fail —
    // proving isolation.

    const { default: freshDOMPurify } = await import('dompurify')
    const externalPurify = freshDOMPurify(window)

    // Trigger our markdown renderer first so any hook registration runs.
    renderMarkdown('<img src="data:image/png;base64,AAA" alt="x">')

    const externalHtml = externalPurify.sanitize(
      '<img src="data:image/png;base64,AAA" alt="x">',
      { ALLOWED_URI_REGEXP: /^(?!javascript:|data:)/ },
    )
    expect(externalHtml).toMatch(/src="data:image\/png/)
  })
})
