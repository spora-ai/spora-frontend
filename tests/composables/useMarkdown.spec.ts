// @vitest-environment jsdom
/**
 * useMarkdown — tests for the markdown renderer.
 *
 * Runs in jsdom rather than the default happy-dom because DOMPurify 3.x
 * delegates the parser to the host environment's `<script>` handling
 * (raw-text content model). happy-dom's parser doesn't honour that
 * model, so a `<script>` inside an allowed block element survives
 * sanitization under happy-dom even though a real browser would
 * correctly strip it. jsdom's HTML parser matches browser behaviour
 * closely enough for the assertions below to reflect production.
 *
 * Verifies:
 *  - Plain markdown becomes HTML
 *  - Code blocks include language label and code-block wrapper
 *  - Sanitizer strips dangerous protocols and scripts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderMarkdown } from '@/composables/useMarkdown'

/**
 * Whether the byte at `index` sits inside an `@layer … { … }` block.
 *
 * jsdom does not implement cascade layers, so no computed-style assertion
 * here could tell a layered rule from an unlayered one. Walking the braces
 * is the only way to check the property that actually decides the cascade.
 * Comments are blanked to spaces first, since this file's prose names
 * `@layer` and would otherwise open a block that does not exist.
 */
const isInsideLayerBlock = (css: string, index: number): boolean => {
  const blanked = css.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
  let depth = 0
  let inLayer = false
  for (let i = 0; i < index; i++) {
    if (blanked.startsWith('@layer', i)) inLayer = true
    if (blanked[i] === '{') depth++
    else if (blanked[i] === '}') {
      depth--
      if (depth === 0) inLayer = false
    }
  }
  return inLayer
}

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

  // ── Plugin-generated file card (spora-core MediaEmbed::fileCard) ───────
  // The card is emitted as an HTML string from PHP, so it has no component and
  // no scoped styles: these assertions ARE the styling contract. Every class
  // the card relies on is a Tailwind utility that the scanner never sees,
  // because it is not in this repo — spora-frontend registers the exact list
  // with `@source inline(...)` in src/style.css. If a class is dropped here,
  // or drifts from that list, the card silently renders unstyled.

  /** Mirrors MediaEmbed::fileCard() with a byte size present. */
  const FILE_CARD =
    '<div class="inline-flex max-w-120 my-[0.6rem] rounded-lg border border-foreground/10 bg-muted">' +
    '<a class="flex min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-inherit no-underline transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-ring spora-file-card__glyph" href="/api/v1/assets/6f1d0a1e-2b3c-4d5e-8f90-abcdef123456.docx">' +
    '<span class="min-w-0 flex-auto truncate font-medium">Q3 report.docx</span>' +
    '<span class="shrink-0 text-xs text-muted-foreground">12.1 KB</span>' +
    '</a></div>'

  /** The same card with no size, so the size span is omitted entirely. */
  const FILE_CARD_WITHOUT_SIZE =
    '<div class="inline-flex max-w-120 my-[0.6rem] rounded-lg border border-foreground/10 bg-muted">' +
    '<a class="flex min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-inherit no-underline transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-ring spora-file-card__glyph" href="/api/v1/assets/6f1d0a1e-2b3c-4d5e-8f90-abcdef123456.docx">' +
    '<span class="min-w-0 flex-auto truncate font-medium">Q3 report.docx</span>' +
    '</a></div>'

  it('preserves every Tailwind class on the file card, on the element that needs it', () => {
    // Per element, not one `toContain` over the whole attribute: `toContain`
    // is a substring test, so `flex` is satisfied by `flex-auto` and `border`
    // by `border-foreground/10`, and the card could lose `display:flex` —
    // which is what makes the filename ellipsise at all — while this passed.
    // `classList.contains` also cannot be satisfied by a sibling's class name.
    const host = document.createElement('div')
    host.innerHTML = renderMarkdown(FILE_CARD)
    const card = host.querySelector('div')
    const link = host.querySelector('a')
    const name = link?.querySelector('span')
    const size = link?.querySelectorAll('span')[1]

    const expectAll = (el: Element | undefined, classes: string[], where: string) => {
      for (const cls of classes) {
        expect(el?.classList.contains(cls), `${where} lost "${cls}"`).toBe(true)
      }
    }

    expectAll(card, ['inline-flex', 'max-w-120', 'my-[0.6rem]', 'rounded-lg', 'border', 'border-foreground/10', 'bg-muted'], 'div')
    expectAll(link, [
      'flex', 'min-w-0', 'items-center', 'gap-2.5', 'rounded-lg', 'px-3', 'py-2',
      'text-inherit', 'no-underline', 'transition-colors', 'hover:bg-primary/10',
      'focus-visible:outline-2', 'focus-visible:outline-offset-[-1px]',
      'focus-visible:outline-ring', 'spora-file-card__glyph',
    ], 'a')
    expectAll(name, ['min-w-0', 'flex-auto', 'truncate', 'font-medium'], 'filename span')
    expectAll(size, ['shrink-0', 'text-xs', 'text-muted-foreground'], 'size span')
  })

  it('resets the two declarations the bubble link rule would otherwise win', () => {
    // The card's anchor is a whole block, not an inline citation, so it must
    // not read as one. `no-underline` and `text-inherit` are on the element,
    // but both lose: `.chat-bubble-content a` is unlayered and outranks
    // everything in `@layer utilities`. So the assertion covers both halves —
    // the utilities in the markup, and a stylesheet rule that resets what
    // they were meant to reset. Checking the classes alone would have passed
    // while the card was visibly underlined and link-blue.
    const host = document.createElement('div')
    host.className = 'chat-bubble-content'
    host.innerHTML = renderMarkdown(FILE_CARD)
    const anchorClasses = host.querySelector('a')?.classList
    expect(anchorClasses?.contains('no-underline')).toBe(true)
    expect(anchorClasses?.contains('text-inherit')).toBe(true)

    // Resolved from the project root rather than `import.meta.url`: Vitest
    // rewrites that to a non-`file:` URL under the jsdom environment.
    const css = readFileSync(resolve(process.cwd(), 'src/style.css'), 'utf8')

    // The bubble rule that competes with the card.
    const competing = /\.chat-bubble-content a\s*\{[^}]*text-decoration:\s*underline/
    expect(css, '.chat-bubble-content a no longer underlines — re-check the card').toMatch(competing)

    const reset = /\.chat-bubble-content \.spora-file-card__glyph\s*\{([^}]*)\}/
    const m = css.match(reset)
    expect(m, 'no .chat-bubble-content .spora-file-card__glyph rule to win the cascade').not.toBeNull()
    expect(m?.[1]).toMatch(/text-decoration:\s*none/)
    expect(m?.[1]).toMatch(/color:\s*inherit/)

    // The reset has to stay unlayered, and that is the operative reason it
    // wins — specificity only breaks the tie once the layers match, so a
    // specificity check on its own would pass against a rule that loses. The
    // card's anchor must also keep a colour class, or it inherits whatever
    // the card's container uses and the filename stops reading as text.
    expect(isInsideLayerBlock(css, m?.index ?? -1), 'the card reset moved inside @layer — utilities would win again')
      .toBe(false)
  })

  it('preserves the href, the filename and the size', () => {
    const html = renderMarkdown(FILE_CARD)
    expect(html).toContain('href="/api/v1/assets/6f1d0a1e-2b3c-4d5e-8f90-abcdef123456.docx"')
    expect(html).toContain('Q3 report.docx')
    expect(html).toContain('12.1 KB')
  })

  it('keeps the file card tree shaped div > a > span', () => {
    // The utilities assume this shape: `min-w-0` and `truncate` only truncate
    // inside a flex row, so a flattened or re-wrapped tree would leave the
    // filename overflowing rather than ellipsised.
    const host = document.createElement('div')
    host.innerHTML = renderMarkdown(FILE_CARD)

    const card = host.querySelector('div')
    expect(card).not.toBeNull()
    expect(card?.className).toContain('bg-muted')

    const link = card?.querySelector(':scope > a')
    expect(link?.getAttribute('href')).toBe('/api/v1/assets/6f1d0a1e-2b3c-4d5e-8f90-abcdef123456.docx')
    expect(link?.className).toContain('spora-file-card__glyph')

    const spans = link?.querySelectorAll(':scope > span')
    expect(spans).toHaveLength(2)
    expect(spans?.[0].textContent).toBe('Q3 report.docx')
    expect(spans?.[0].className).toContain('truncate')
    expect(spans?.[1].textContent).toBe('12.1 KB')
    expect(spans?.[1].className).toContain('shrink-0')
  })

  it('keeps the filename readable beside a size span that cannot shrink', () => {
    // The bug this markup exists to prevent: the meta span used to carry the
    // full MIME, and at `flex-shrink: 0` a 71-character
    // `application/vnd.openxmlformats-…` won the row outright and squeezed the
    // filename to 0px. The filename span now carries `min-w-0 flex-auto
    // truncate` and the size span is short and `shrink-0`, so the name always
    // has room and ellipsises instead. Pinned here because the failure is
    // invisible in the DOM — the name is present, it just measures zero.
    const host = document.createElement('div')
    host.innerHTML = renderMarkdown(FILE_CARD)
    const link = host.querySelector('a')

    const name = link?.querySelector('span')
    const size = link?.querySelectorAll('span')[1]

    expect(name?.className).toContain('min-w-0')
    expect(name?.className).toContain('flex-auto')
    expect(name?.className).toContain('truncate')
    // The size is the only thing allowed to hold its width, and it is short.
    expect(size?.className).toContain('shrink-0')
    expect(size?.textContent?.length).toBeLessThanOrEqual(12)
  })

  it('carries no MIME, so no long unbreakable string can crowd the name', () => {
    const html = renderMarkdown(FILE_CARD)
    expect(html).not.toContain('application/')
    expect(html).not.toContain('openxmlformats')
  })

  it('keeps the file card intact when the optional size span is absent', () => {
    // MediaEmbed::fileCard() omits the size span when the byte size is unknown,
    // so nothing may assume it exists — and sanitizing must not invent it.
    const host = document.createElement('div')
    host.innerHTML = renderMarkdown(FILE_CARD_WITHOUT_SIZE)

    const link = host.querySelector('div > a')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toContain('/api/v1/assets/')
    expect(link?.querySelectorAll('span')).toHaveLength(1)
    expect(link?.querySelector('span')?.textContent).toBe('Q3 report.docx')
  })

  it('emits no element or attribute the sanitizer could strip from the file card', () => {
    // Asserted on the emitted contract as well as the sanitized output: the
    // sanitiser would happily hide an `aria-hidden` regression, and the whole
    // point is that the markup never carries one.
    //
    // The tag list is `svg` / `i` / `img` / `picture` only. `em` and `strong`
    // are deliberately absent — both ARE in ALLOWED_TAGS, so banning them
    // here would assert something false about the sanitiser. They are still
    // excluded from the card markup because its vocabulary is
    // div / a / span only, which the next assertion pins.
    for (const markup of [FILE_CARD, FILE_CARD_WITHOUT_SIZE]) {
      expect(markup).not.toContain('aria-hidden')
      expect(markup).not.toContain('download')
      expect(markup).not.toMatch(/<(svg|i|img|picture)\b/i)
    }

    const host = document.createElement('div')
    host.innerHTML = renderMarkdown(FILE_CARD)
    const tags = Array.from(host.querySelectorAll('*')).map((el) => el.tagName.toLowerCase())
    expect(new Set(tags)).toEqual(new Set(['div', 'a', 'span']))
  })

  it('carries no glyph character in the DOM for a screen reader to announce', () => {
    // The download glyph is a CSS `::before` on `.spora-file-card__glyph`, and
    // specifically an SVG mask rather than `content: '↓'`. Generated `content`
    // text participates in the accessible-name computation in Chrome and
    // Firefox, so a text glyph would be announced as "downwards arrow" before
    // every filename — the exact a11y problem that having no DOM node is meant
    // to avoid. This asserts the half that lives in the markup: no node whose
    // content is a symbol. The mask half lives in style.css and is not
    // testable here.
    const host = document.createElement('div')
    host.innerHTML = renderMarkdown(FILE_CARD)

    for (const el of Array.from(host.querySelectorAll('*'))) {
      expect(el.textContent).not.toMatch(/[←→↑↓⇩⬇⤓]/)
    }
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
