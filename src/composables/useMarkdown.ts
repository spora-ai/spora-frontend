import { marked, Renderer } from 'marked'
import hljs from 'highlight.js'
import DOMPurify, { type DOMPurify as DOMPurifyType } from 'dompurify'

/**
 * Markdown rendering with syntax highlighting and sanitization.
 */
const COPY_BTN_INNER = `<span class="code-block-copy"><svg class="code-block-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</span>`

const renderer = new Renderer()
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : null
  const highlighted = language
    ? hljs.highlight(text, { language }).value
    : text
  const langClass = language ? ` language-${language}` : ''
  const langLabel = lang ?? 'code'
  return `<div class="code-block" data-code-placeholder="${encodeURIComponent(text)}"><div class="code-block-header"><span class="code-block-lang">${langLabel}</span><span class="code-block-copy-placeholder"></span></div><pre><code class="hljs${langClass}">${highlighted}</code></pre></div>`
}
marked.use({ renderer })

/**
 * Scopes `data:` URI handling on a PRIVATE DOMPurify instance (see {@link getMarkdownPurify}):
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

/**
 * DOMPurify instance dedicated to markdown sanitization. Uses `globalThis`
 * (not `window`) so this also works under SSR/workers/happy-dom. The hook
 * is installed once on first use and never torn down, so it stays scoped
 * to this module and never leaks onto other consumers of DOMPurify.
 */
let markdownPurifySingleton: DOMPurifyType | null = null
function getMarkdownPurify(): DOMPurifyType {
  if (markdownPurifySingleton === null) {
    markdownPurifySingleton = DOMPurify(globalThis)
    markdownPurifySingleton.addHook('uponSanitizeAttribute', MEDIA_DATA_URI_HOOK)
  }
  return markdownPurifySingleton
}

export function renderMarkdown(src: string = ''): string {
  let html: string
  try {
    html = marked.parse(src) as string
  } catch {
    return src
  }
  const clean = getMarkdownPurify().sanitize(html, {
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