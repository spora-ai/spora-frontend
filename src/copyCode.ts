/**
 * Delegated copy-code handler for code blocks rendered via v-html.
 *
 * The icon node is captured at click time and re-attached via cloneNode so we
 * never re-parse HTML through innerHTML. The icon itself was sanitized when
 * the code block was first rendered (see useMarkdown.renderMarkdown), but
 * round-tripping it through innerHTML would re-invoke the HTML parser, which
 * is fragile against any future regression in the upstream sanitizer.
 *
 * The button label is written straight into the DOM, so it is translated
 * through the global composer rather than a component's `useI18n()` — there
 * is no component instance here to inject one into.
 */
import { i18n } from '@/i18n'

document.addEventListener('click', async (e: MouseEvent) => {
  const btn = (e.target as HTMLElement).closest('.code-block-copy') as HTMLElement | null
  if (!btn) return

  const code = decodeURIComponent((btn.closest('.code-block') as HTMLElement)?.dataset.code ?? '')
  if (!code) return

  // Capture the icon as a live node, detached from the original location,
  // so we can clone it back without ever parsing markup. We keep a single
  // source-of-truth reference and clone on every re-render.
  const icon = btn.querySelector('.code-block-copy-icon')
  const iconSource = icon ?? null

  const renderIcon = (): void => {
    btn.textContent = ''
    if (iconSource) btn.appendChild(iconSource.cloneNode(true))
  }

  try {
    await navigator.clipboard.writeText(code)
    btn.classList.add('copied')
    renderIcon()
    btn.appendChild(document.createTextNode(' ' + i18n.global.t('Copied!')))
    setTimeout(() => {
      btn.classList.remove('copied')
      renderIcon()
      btn.appendChild(document.createTextNode(' ' + i18n.global.t('Copy')))
    }, 2000)
  } catch {
    renderIcon()
    btn.appendChild(document.createTextNode(' ' + i18n.global.t('Failed')))
    setTimeout(() => {
      btn.classList.remove('copied')
      renderIcon()
      btn.appendChild(document.createTextNode(' ' + i18n.global.t('Copy')))
    }, 2000)
  }
})