import { marked, Renderer } from 'marked'
import type { Tokens } from 'marked'
import hljs from '@/lib/highlight'
import DOMPurify from 'dompurify'

/**
 * Markdown rendering with syntax highlighting and sanitization.
 */
const COPY_BTN_INNER = `<span class="code-block-copy"><svg class="code-block-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</span>`

/**
 * The route a model writes to ask for a live frame.
 *
 * A path, not a fragment. The server is what decides whether the framed
 * document may run script, and it decides by the path it is asked for — a
 * fragment never leaves the browser, so it cannot select a policy. The
 * reference is also the frame's `src`, so the path the server serves is
 * the path the client frames, with no mapping between the two.
 */
const EMBED_ROUTE = /^\/api\/v1\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/embed$/i

/**
 * The placeholder a link to the embed route becomes.
 *
 * It carries the asset id and the link's own text, and nothing else. The
 * frame itself is a Vue component the chat mounts — the sanitiser's
 * allow-list carries no `iframe`, and widening it would put every chat
 * bubble in scope.
 */
function embedPlaceholder(assetId: string, label: string): string {
  return `<span data-media-embed="${assetId}">${label}</span>`
}

const renderer = new Renderer()
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : null
  const highlighted = language
    ? hljs.highlight(text, { language }).value
    : text
  const langClass = language ? ` language-${language}` : ''
  const langLabel = language ?? 'code'
  return `<div class="code-block" data-code-placeholder="${encodeURIComponent(text)}"><div class="code-block-header"><span class="code-block-lang">${langLabel}</span><span class="code-block-copy-placeholder"></span></div><pre><code class="hljs${langClass}">${highlighted}</code></pre></div>`
}
marked.use({ renderer })

/**
 * A link to the embed route becomes a placeholder the chat can replace
 * with a live frame.
 *
 * `false` tells marked to use its own link renderer, so every other link
 * is untouched.
 */
marked.use({
  renderer: {
    link(this: Renderer, { href, tokens }: Tokens.Link): string | false {
      const match = EMBED_ROUTE.exec(href)
      if (match === null) {
        return false
      }
      return embedPlaceholder(match[1], this.parser.parseInline(tokens))
    },
  },
})

/**
 * Scopes `data:` URI handling on a PRIVATE DOMPurify instance:
 *  - allow on `<audio>`/`<video>`/`<source>` src — spora-core's MediaEmbed helpers
 *  - deny on `<img>` src — base64 image payloads can carry SVG-with-script
 *  - no effect on `<a href>` (stays blocked by ALLOWED_URI_REGEXP below)
 *
 * Scheme compare is case-insensitive (RFC 3986 §3.1): DaTa: / DATA: / dAtA: must
 * match `data:` exactly.
 */
const MEDIA_DATA_URI_HOOK = (node: Element, ev: { attrName: string; attrValue?: string; keepAttr?: boolean }): void => {
  if (ev.attrName !== 'src' || typeof ev.attrValue !== 'string') {
    return
  }
  if (ev.attrValue.slice(0, 5).toLowerCase() !== 'data:') {
    return
  }
  if (node.nodeName === 'AUDIO' || node.nodeName === 'VIDEO' || node.nodeName === 'SOURCE') {
    ev.keepAttr = true
  } else if (node.nodeName === 'IMG') {
    // Base64 image payloads can carry SVG-with-script.
    ev.keepAttr = false
  }
}

// Install the hook exactly once at module load. DOMPurify 3.x exposes
// `addHook` directly on the default export (the factory-function API
// `DOMPurify(window)` was removed in 3.0) — installing it eagerly here means
// the hook is in place before the first `sanitize` call, and we never need a
// "is it installed yet?" guard on the hot path.
let markdownHookInstalled = false
function ensureMarkdownHook(): void {
  if (markdownHookInstalled) return
  DOMPurify.addHook('uponSanitizeAttribute', MEDIA_DATA_URI_HOOK)
  markdownHookInstalled = true
}

function renderMarkdownHtml(src: string): string {
  let html: string
  try {
    html = marked.parse(src) as string
  } catch {
    return src
  }
  ensureMarkdownHook()
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'code', 'pre',
      'ul', 'ol', 'li', 'h1', 'h2', 'h3',
      'blockquote', 'a', 'table', 'thead', 'tbody',
      'tr', 'th', 'td', 'span', 'div', 'img',
      // Plugin-generated media — see MediaEmbed helpers in spora-core.
      'video', 'audio', 'source',
    ],
    ALLOWED_ATTR: [
      'href', 'class', 'src', 'alt', 'title',
      // `autoplay` is intentionally omitted — nothing emits it, and
      // allowing it would let any user-supplied HTML auto-play in chat.
      'controls', 'preload', 'poster', 'type',
      'loop', 'muted',
      'width', 'height', 'playsinline',
    ],
    // `i` flag because URI schemes are case-insensitive (RFC 3986 §3.1).
    ALLOWED_URI_REGEXP: /^(?!javascript:|data:)/i,
  })
  return clean
    .replace(/data-code-placeholder="([^"]*)"/g, 'data-code="$1"')
    .replaceAll('<span class="code-block-copy-placeholder"></span>', COPY_BTN_INNER)
}

export function renderMarkdown(src: string = ''): string {
  // A link to the embed route stays a link here. The surfaces that render a
  // plain string — the tool bubble, the reasoning row — have no frame to
  // mount, so the placeholder is put back as the link it was.
  return renderMarkdownHtml(src).replace(
    /<span data-media-embed="([^"]+)">([\s\S]*?)<\/span>/g,
    '<a href="/api/v1/media/$1/embed">$2</a>',
  )
}

/**
 * One piece of a rendered message.
 *
 * `html` is sanitised markup; `embed` is a request for a live frame, and
 * the chat replaces it with the frame component.
 */
export type MarkdownSegment =
  | { kind: 'html'; html: string }
  | { kind: 'embed'; assetId: string; label: string; href: string }

/**
 * The placeholder the link renderer emits, and the paragraph it sits in.
 *
 * A reference on its own line is a paragraph of its own, and the frame
 * that replaces it is a block — so the paragraph is unwrapped and the
 * placeholder becomes the block's boundary. A reference inside a
 * paragraph is left where it is; the split then falls inside the
 * paragraph, which the browser repairs into two.
 */
const EMBED_PLACEHOLDER = /<span data-media-embed="([^"]+)">([\s\S]*?)<\/span>/g
const LONE_EMBED_PARAGRAPH = /<p>(<span data-media-embed="[^"]+">[\s\S]*?<\/span>)<\/p>/g

/**
 * Render a message as the segments it is made of.
 *
 * The chat uses this instead of {@link renderMarkdown} for the assistant's
 * own messages, because a message may ask for a live frame: the frame is
 * a Vue component, and a component cannot live inside the markup the
 * sanitiser produced.
 */
export function renderMarkdownSegments(src: string = ''): MarkdownSegment[] {
  const html = renderMarkdownHtml(src).replace(LONE_EMBED_PARAGRAPH, '$1')

  const segments: MarkdownSegment[] = []
  let cursor = 0
  EMBED_PLACEHOLDER.lastIndex = 0
  let match = EMBED_PLACEHOLDER.exec(html)
  while (match !== null) {
    if (match.index > cursor) {
      segments.push({ kind: 'html', html: html.slice(cursor, match.index) })
    }
    segments.push({
      kind: 'embed',
      assetId: match[1],
      label: match[2],
      href: `/api/v1/media/${match[1]}/embed`,
    })
    cursor = match.index + match[0].length
    match = EMBED_PLACEHOLDER.exec(html)
  }
  if (cursor < html.length) {
    segments.push({ kind: 'html', html: html.slice(cursor) })
  }

  // A segment that is only whitespace is not a segment — it is the
  // newline that separated two blocks.
  return segments.filter((s) => s.kind !== 'html' || s.html.trim() !== '')
}
