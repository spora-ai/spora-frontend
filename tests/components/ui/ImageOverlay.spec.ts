/**
 * ImageOverlay — fullscreen image preview with click-to-zoom semantics.
 *
 * Asserts the prop/API surface, the close paths (button / backdrop / ESC),
 * and that `v-model:open` flips on every close trigger. The native `<dialog>`
 * is teleported to `document.body`, so all assertions go through
 * `document.body.querySelector` rather than `wrapper.find` (Teleport
 * content is outside `wrapper.element`). The component is mounted with
 * `attachTo: document.body` so its click listeners are on a real DOM tree.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, it, expect } from 'vitest'
import ImageOverlay from '@/components/ui/ImageOverlay.vue'

async function mountOpen(propsOverride: Partial<{ src: string, alt: string }> = {}) {
  const wrapper = mount(ImageOverlay, {
    props: {
      open: true,
      src: propsOverride.src ?? 'https://example.test/cat.png',
      alt: propsOverride.alt ?? 'A friendly cat',
    },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

afterEach(() => {
  // Each test attaches a Teleported <dialog> to document.body. Without
  // explicit unmount + cleanup, the dialog leaks into the next test and
  // any `document.body.querySelector` assertions see stale state.
  document.body.innerHTML = ''
})

describe('ImageOverlay', () => {
  it('renders nothing when open is false', () => {
    const wrapper = mount(ImageOverlay, {
      props: { open: false, src: 'https://example.test/x.png' },
      attachTo: document.body,
    })
    expect(document.body.querySelector('[data-testid="image-overlay"]')).toBeNull()
    wrapper.unmount()
  })

  it('renders the dialog and image when open is true', async () => {
    const wrapper = await mountOpen({ src: 'https://example.test/dog.png', alt: 'A dog' })
    const dialog = document.body.querySelector('[data-testid="image-overlay"]')
    expect(dialog).not.toBeNull()
    const img = document.body.querySelector('[data-testid="image-overlay-img"]') as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('https://example.test/dog.png')
    expect(img!.getAttribute('alt')).toBe('A dog')
    wrapper.unmount()
  })

  it('falls back to empty alt when no alt is supplied', async () => {
    const wrapper = await mountOpen({ src: 'https://example.test/blank.png', alt: '' })
    const img = document.body.querySelector('[data-testid="image-overlay-img"]') as HTMLImageElement | null
    expect(img!.getAttribute('alt')).toBe('')
    wrapper.unmount()
  })

  it('closes (emits update:open=false) when the X button is clicked', async () => {
    const wrapper = await mountOpen()
    const closeBtn = document.body.querySelector('[data-testid="image-overlay-close"]') as HTMLButtonElement | null
    expect(closeBtn).not.toBeNull()
    closeBtn!.click()
    await flushPromises()
    const updates = wrapper.emitted('update:open')
    expect(updates).toBeTruthy()
    expect(updates?.at(-1)).toEqual([false])
    wrapper.unmount()
  })

  it('closes when the backdrop (dialog itself) is clicked', async () => {
    const wrapper = await mountOpen()
    const dialog = document.body.querySelector('[data-testid="image-overlay"]') as HTMLDialogElement | null
    expect(dialog).not.toBeNull()
    // `@click.self` only fires when the click target IS the dialog
    // element (not a descendant). Dispatch a bubbling click event with
    // the dialog as the target so the .self guard matches.
    dialog!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const updates = wrapper.emitted('update:open')
    expect(updates?.at(-1)).toEqual([false])
    wrapper.unmount()
  })

  it('does NOT close when the image itself is clicked', async () => {
    const wrapper = await mountOpen()
    const img = document.body.querySelector('[data-testid="image-overlay-img"]') as HTMLImageElement | null
    img!.click()
    await flushPromises()
    // `@click.self` only matches when target === currentTarget, so a
    // click on the descendant <img> bubbles up but is filtered out.
    expect(wrapper.emitted('update:open')).toBeFalsy()
    wrapper.unmount()
  })

  it('closes when the cancel event is fired (ESC by the browser)', async () => {
    const wrapper = await mountOpen()
    const dialog = document.body.querySelector('[data-testid="image-overlay"]') as HTMLDialogElement | null
    dialog!.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }))
    const updates = wrapper.emitted('update:open')
    expect(updates?.at(-1)).toEqual([false])
    wrapper.unmount()
  })

  it('closes when the parent flips open to false via v-model', async () => {
    const wrapper = await mountOpen()
    expect(document.body.querySelector('[data-testid="image-overlay"]')).not.toBeNull()
    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(document.body.querySelector('[data-testid="image-overlay"]')).toBeNull()
    wrapper.unmount()
  })
})
