/**
 * UninstallPluginModal — confirmation modal that calls store.uninstall().
 *
 * The modal is teleported to <body>, so the rendered DOM lives outside the
 * wrapper tree. Tests query by data-testid on document.body.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const uninstallMock = vi.fn()
const mutating = ref(false)

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

vi.mock('@/apps/plugins/stores/plugins', () => ({
  usePluginsStore: () => ({
    get mutating() { return mutating.value },
    uninstall: uninstallMock,
  }),
}))

import UninstallPluginModal from '@/apps/plugins/components/UninstallPluginModal.vue'
import { ApiError } from '@/api/client'

beforeEach(() => {
  setActivePinia(createPinia())
  mutating.value = false
  uninstallMock.mockReset()
  document.body.querySelectorAll('[data-testid="uninstall-plugin-modal"]').forEach(el => el.remove())
})

afterEach(() => {
  document.body.querySelectorAll('[data-testid="uninstall-plugin-modal"]').forEach(el => el.remove())
})

function modalInBody(): HTMLElement | null {
  return document.body.querySelector('[data-testid="uninstall-plugin-modal"]')
}

function mountModal(props: { open: boolean; packageName: string } = { open: true, packageName: 'spora-ai/spora-plugin-tavily' }) {
  return mount(UninstallPluginModal, {
    attachTo: document.body,
    props,
  })
}

describe('UninstallPluginModal', () => {
  it('does not render anything when open is false', () => {
    mountModal({ open: false, packageName: 'spora-ai/spora-plugin-tavily' })
    expect(modalInBody()).toBeNull()
  })

  it('renders the confirmation copy and the package name when open', () => {
    mountModal()
    expect(modalInBody()).not.toBeNull()
    expect(document.body.textContent ?? '').toContain('Uninstall plugin')
    expect(document.body.textContent ?? '').toContain('spora-ai/spora-plugin-tavily')
    expect(document.body.textContent ?? '').toContain('php bin/spora plugin:install')
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
    const modal = document.body.querySelector('[data-testid="uninstall-plugin-modal"]')?.parentElement as HTMLElement | null
    expect(modal).not.toBeNull()
    modal!.click()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('calls store.uninstall with the package name and emits uninstalled + close on success', async () => {
    uninstallMock.mockResolvedValueOnce({ package: 'spora-ai/spora-plugin-tavily', status: 'uninstalled' })
    const wrapper = mountModal()
    const submit = document.body.querySelector('[data-testid="uninstall-submit"]') as HTMLButtonElement
    expect(submit).not.toBeNull()
    submit.click()
    await flushPromises()
    expect(uninstallMock).toHaveBeenCalledWith('spora-ai/spora-plugin-tavily')
    expect(wrapper.emitted('uninstalled')).toBeTruthy()
    expect(wrapper.emitted('uninstalled')![0]).toEqual([{ package: 'spora-ai/spora-plugin-tavily' }])
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('renders the submitError banner when uninstall fails with an ApiError', async () => {
    uninstallMock.mockRejectedValueOnce(new ApiError('Forbidden', 'FORBIDDEN', 403))
    const wrapper = mountModal()
    const submit = document.body.querySelector('[data-testid="uninstall-submit"]') as HTMLButtonElement
    submit.click()
    await flushPromises()
    const errorBanner = document.body.querySelector('[data-testid="uninstall-error"]')
    expect(errorBanner).not.toBeNull()
    expect(errorBanner!.textContent).toContain('Forbidden')
    expect(wrapper.emitted('uninstalled')).toBeFalsy()
    expect(wrapper.emitted('close')).toBeFalsy()
  })

  it('renders a generic error banner when uninstall fails with a non-ApiError', async () => {
    uninstallMock.mockRejectedValueOnce(new Error('Network down'))
    mountModal()
    const submit = document.body.querySelector('[data-testid="uninstall-submit"]') as HTMLButtonElement
    submit.click()
    await flushPromises()
    const errorBanner = document.body.querySelector('[data-testid="uninstall-error"]')
    expect(errorBanner).not.toBeNull()
    expect(errorBanner!.textContent).toContain('Uninstall failed.')
  })

  it('disables the submit button while the store is mutating', () => {
    mutating.value = true
    mountModal()
    const submit = document.body.querySelector('[data-testid="uninstall-submit"]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(submit.textContent).toContain('Uninstalling')
  })

  it('clears the previous error when the modal is reopened', async () => {
    uninstallMock.mockRejectedValueOnce(new ApiError('First failure', 'FAIL', 500))
    const wrapper = mountModal({ open: true, packageName: 'spora-ai/spora-plugin-tavily' })
    const submit = document.body.querySelector('[data-testid="uninstall-submit"]') as HTMLButtonElement
    submit.click()
    await flushPromises()
    expect(document.body.querySelector('[data-testid="uninstall-error"]')).not.toBeNull()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(document.body.querySelector('[data-testid="uninstall-error"]')).toBeNull()
  })
})