/**
 * GlobalSheet — right-anchored slide-in panel.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import GlobalSheet from '@/components/navbar/GlobalSheet.vue'

beforeEach(() => {
  document.body.innerHTML = ''
  document.body.classList.remove('overflow-hidden')
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('GlobalSheet', () => {
  it('renders nothing when closed', () => {
    mount(GlobalSheet, { props: { open: false } })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders the dialog when open', async () => {
    mount(GlobalSheet, { props: { open: true } })
    await nextTick()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('locks body scroll while open', async () => {
    mount(GlobalSheet, { props: { open: true } })
    await nextTick()
    expect(document.body.classList.contains('overflow-hidden')).toBe(true)
  })

  it('unlocks body scroll when closed', async () => {
    const wrapper = mount(GlobalSheet, { props: { open: true } })
    await nextTick()
    expect(document.body.classList.contains('overflow-hidden')).toBe(true)
    await wrapper.setProps({ open: false })
    expect(document.body.classList.contains('overflow-hidden')).toBe(false)
    wrapper.unmount()
  })

  it('emits update:open when the backdrop is clicked', async () => {
    const wrapper = mount(GlobalSheet, { props: { open: true } })
    await nextTick()
    const backdrop = document.querySelector('button[aria-label="Close menu"]') as HTMLButtonElement
    backdrop.click()
    await flushPromises()
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('emits update:open when the identity close button is clicked', async () => {
    const IdentityStub = {
      name: 'IdentityStub',
      template: '<button type="button" aria-label="Close menu" @click="$emit(\'close\')">X</button>',
    }
    const wrapper = mount(GlobalSheet, {
      props: { open: true },
      slots: { identity: '<IdentityStub @close="close" />' },
      global: { components: { IdentityStub } },
    })
    await nextTick()
    const closeBtn = document.querySelector('[role="dialog"] button[aria-label="Close menu"]:not(.cursor-default)') as HTMLButtonElement
    expect(closeBtn).not.toBeNull()
    closeBtn.click()
    await flushPromises()
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('emits update:open on ESC key', async () => {
    const wrapper = mount(GlobalSheet, { props: { open: true } })
    await nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('cleans up body scroll-lock on unmount even if still open', async () => {
    const wrapper = mount(GlobalSheet, { props: { open: true } })
    await nextTick()
    expect(document.body.classList.contains('overflow-hidden')).toBe(true)
    wrapper.unmount()
    expect(document.body.classList.contains('overflow-hidden')).toBe(false)
  })
})
