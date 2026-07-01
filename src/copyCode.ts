/**
 * Delegated copy-code handler for code blocks rendered via v-html.
 *
 * The icon node is captured at click time and re-attached via cloneNode so
 * we never re-parse HTML through innerHTML. The icon itself was sanitized
 * when the code block was first rendered (see useMarkdown.renderMarkdown),
 * but round-tripping it through innerHTML would re-invoke the HTML parser,
 * which is fragile against any future regression in the upstream sanitizer.
 */
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
    btn.appendChild(document.createTextNode(' Copied!'))
    setTimeout(() => {
      btn.classList.remove('copied')
      renderIcon()
      btn.appendChild(document.createTextNode(' Copy'))
    }, 2000)
  } catch {
    renderIcon()
    btn.appendChild(document.createTextNode(' Failed'))
    setTimeout(() => {
      btn.classList.remove('copied')
      renderIcon()
      btn.appendChild(document.createTextNode(' Copy'))
    }, 2000)
  }
})