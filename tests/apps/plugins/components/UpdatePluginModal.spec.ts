/**
 * UpdatePluginModal — modal that re-pins a plugin to a new constraint and
 * calls store.update(). Mirrors docs/20_plugin_install_api.md § PATCH.
 *
 * The modal is teleported to <body>, so the rendered DOM lives outside the
 * wrapper tree. Tests query by data-testid on document.body.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const updateMock = vi.fn()
const mutating = ref(false)

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

vi.mock('@/apps/plugins/stores/plugins', () => ({
  usePluginsStore: () => ({
    get mutating() { return mutating.value },
    update: updateMock,
  }),
}))

import UpdatePluginModal from '@/apps/plugins/components/UpdatePluginModal.vue'
import { ApiError } from '@/api/client'

beforeEach(() => {
  setActivePinia(createPinia())
  mutating.value = false
  updateMock.mockReset()
  document.body.querySelectorAll('[data-testid="update-plugin-modal"]').forEach(el => el.remove())
})

afterEach(() => {
  document.body.querySelectorAll('[data-testid="update-plugin-modal"]').forEach(el => el.remove())
})

function modalInBody(): HTMLElement | null {
  return document.body.querySelector('[data-testid="update-plugin-modal"]')
}

function mountModal(props: { open: boolean; packageName: string } = { open: true, packageName: 'spora-ai/spora-plugin-tavily' }) {
  return mount(UpdatePluginModal, {
    attachTo: document.body,
    props,
  })
}

describe('UpdatePluginModal', () => {
  it('does not render anything when open is false', () => {
    mountModal({ open: false, packageName: 'spora-ai/spora-plugin-tavily' })
    expect(modalInBody()).toBeNull()
  })

  it('renders the modal copy and the package name when open', () => {
    mountModal()
    expect(modalInBody()).not.toBeNull()
    expect(document.body.textContent ?? '').toContain('Update plugin')
    expect(document.body.textContent ?? '').toContain('spora-ai/spora-plugin-tavily')
  })

  it('emits close when the X button is clicked', async () => {
    const wrapper = mountModal()
    const closeBtn = document.body.querySelector('button[aria-label="Close dialog"]') as HTMLElement | null
    expect(closeBtn).not.toBeNull()
    closeBtn!.click()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('emits close when the Cancel button is clicked', async () => {
    const wrapper = mountModal()
    const buttons = Array.from(document.body.querySelectorAll('button[type="button"]')) as HTMLButtonElement[]
    const cancel = buttons.find(b => b.textContent?.trim() === 'Cancel') as HTMLButtonElement | undefined
    expect(cancel).toBeDefined()
    cancel!.click()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('emits close when the backdrop is clicked', async () => {
    const wrapper = mountModal()
    const modal = document.body.querySelector('[data-testid="update-plugin-modal"]')?.parentElement as HTMLElement | null
    expect(modal).not.toBeNull()
    modal!.click()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('submits an empty object when the constraint is left blank', async () => {
    updateMock.mockResolvedValueOnce({ package: 'spora-ai/spora-plugin-tavily', status: 'updated' })
    const wrapper = mountModal()
    const form = document.body.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(updateMock).toHaveBeenCalledWith('spora-ai/spora-plugin-tavily', {})
    expect(wrapper.emitted('updated')).toBeTruthy()
    expect(wrapper.emitted('updated')![0]).toEqual([{ package: 'spora-ai/spora-plugin-tavily' }])
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('submits the trimmed constraint when it is non-empty', async () => {
    updateMock.mockResolvedValueOnce({ package: 'spora-ai/spora-plugin-tavily', status: 'updated', constraint: '^0.3' })
    const wrapper = mountModal()
    const input = document.body.querySelector('[data-testid="update-constraint-input"]') as HTMLInputElement
    input.value = '  ^0.3  '
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const form = document.body.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(updateMock).toHaveBeenCalledWith('spora-ai/spora-plugin-tavily', { constraint: '^0.3' })
    expect(wrapper.emitted('updated')).toBeTruthy()
  })

  it('renders the submitError banner when update fails with an ApiError', async () => {
    updateMock.mockRejectedValueOnce(new ApiError('Network error', 'NETWORK', 500))
    const wrapper = mountModal()
    const form = document.body.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    const errorBanner = document.body.querySelector('[data-testid="update-error"]')
    expect(errorBanner).not.toBeNull()
    expect(errorBanner!.textContent).toContain('Network error')
    expect(wrapper.emitted('updated')).toBeFalsy()
    expect(wrapper.emitted('close')).toBeFalsy()
  })

  it('renders a generic error banner when update fails with a non-ApiError', async () => {
    updateMock.mockRejectedValueOnce(new Error('Boom'))
    mountModal()
    const form = document.body.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    const errorBanner = document.body.querySelector('[data-testid="update-error"]')
    expect(errorBanner).not.toBeNull()
    expect(errorBanner!.textContent).toContain('Update failed.')
  })

  it('disables the submit button while the store is mutating', () => {
    mutating.value = true
    mountModal()
    const submit = document.body.querySelector('[data-testid="update-submit"]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(submit.textContent).toContain('Updating')
  })

  it('clears the previous error and constraint when reopened', async () => {
    updateMock.mockRejectedValueOnce(new Error('Boom'))
    const wrapper = mountModal({ open: true, packageName: 'spora-ai/spora-plugin-tavily' })
    const input = document.body.querySelector('[data-testid="update-constraint-input"]') as HTMLInputElement
    input.value = '^0.3'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const form = document.body.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.body.querySelector('[data-testid="update-error"]')).not.toBeNull()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(document.body.querySelector('[data-testid="update-error"]')).toBeNull()
    const newInput = document.body.querySelector('[data-testid="update-constraint-input"]') as HTMLInputElement
    expect(newInput.value).toBe('')
  })
})