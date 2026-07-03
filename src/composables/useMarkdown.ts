import { marked, Renderer } from 'marked'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'

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
 * Per-call DOMPurify hook that scopes `data:` URI handling:
 *  - Allows `data:` on `<audio>`, `<video>`, `<source>` src (plugin
 *    generated media via spora-core's MediaEmbed helpers).
 *  - Strips `data:` on `<img>` src — DOMPurify's default ALLOWED_URI_REGEXP
 *    allows them for img, which would let base64 image XSS slip through
 *    if a plugin ever emits `<img src="data:image/svg+xml,…">`.
 *  - Touches nothing else; `data:` on `<a href>` stays blocked.
 *
 * The hook is registered and removed inside `renderMarkdown()` so it never
 * leaks across calls or to other DOMPurify consumers in the SPA.
 */
const MEDIA_DATA_URI_HOOK = (node: Element, ev: { attrName: string; attrValue?: string; keepAttr?: boolean }): void => {
  if (ev.attrName !== 'src' || typeof ev.attrValue !== 'string') {
    return
  }
  const isData = ev.attrValue.startsWith('data:')
  if (!isData) {
    return
  }
  if (node.nodeName === 'AUDIO' || node.nodeName === 'VIDEO' || node.nodeName === 'SOURCE') {
    ev.keepAttr = true
  } else if (node.nodeName === 'IMG') {
    // Explicit deny — base64 image payloads can carry SVG-with-script.
    ev.keepAttr = false
  }
}

export function renderMarkdown(src: string = ''): string {
  let html: string
  try {
    html = marked.parse(src) as string
  } catch {
    return src
  }
  DOMPurify.addHook('uponSanitizeAttribute', MEDIA_DATA_URI_HOOK)
  let clean: string
  try {
    clean = DOMPurify.sanitize(html, {
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
        // Media element attributes — conservative allow-list.
        'controls', 'preload', 'poster', 'type',
        'loop', 'muted', 'autoplay',
        'width', 'height', 'playsinline',
      ],
      // data: URIs are blocked globally; the hook above re-allows them
      // only for media-element src. <a href="data:…"> remains blocked.
      ALLOWED_URI_REGEXP: /^(?!javascript:|data:)/,
    })
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute')
  }
  return clean
    .replace(/data-code-placeholder="([^"]*)"/g, 'data-code="$1"')
    .replace(/<span class="code-block-copy-placeholder"><\/span>/g, COPY_BTN_INNER)
}