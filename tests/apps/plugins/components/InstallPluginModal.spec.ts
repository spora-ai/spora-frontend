/**
 * InstallPluginModal — modal that collects {package, constraint?} and calls
 * the plugins store to install. Mirrors docs/20_plugin_install_api.md.
 *
 * The modal is teleported to <body>, so the rendered DOM lives outside the
 * wrapper tree. Tests query by data-testid on document.body to keep
 * assertions focused on user-visible behaviour.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const installMock = vi.fn()
const mutating = ref(false)

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

vi.mock('@/apps/plugins/stores/plugins', () => ({
  usePluginsStore: () => ({
    get mutating() { return mutating.value },
    install: installMock,
  }),
}))

import InstallPluginModal from '@/apps/plugins/components/InstallPluginModal.vue'
import { ApiError } from '@/api/client'

beforeEach(() => {
  setActivePinia(createPinia())
  mutating.value = false
  installMock.mockReset()
  document.body.querySelectorAll('[data-testid="install-plugin-modal"]').forEach(el => el.remove())
})

afterEach(() => {
  document.body.querySelectorAll('[data-testid="install-plugin-modal"]').forEach(el => el.remove())
})

function modalInBody(): HTMLElement | null {
  return document.body.querySelector('[data-testid="install-plugin-modal"]')
}

function mountModal(props: { open: boolean } = { open: true }) {
  return mount(InstallPluginModal, {
    attachTo: document.body,
    props,
  })
}

describe('InstallPluginModal', () => {
  it('does not render anything when open is false', () => {
    mountModal({ open: false })
    expect(modalInBody()).toBeNull()
  })

  it('renders the modal shell when open is true', () => {
    mountModal()
    expect(modalInBody()).not.toBeNull()
    expect(document.body.textContent ?? '').toContain('Install plugin')
  })

  it('disables the submit button when the package is empty', () => {
    mountModal()
    const submit = document.body.querySelector('[data-testid="install-submit"]') as HTMLButtonElement | null
    expect(submit).not.toBeNull()
    expect(submit!.disabled).toBe(true)
  })

  it('enables the submit button when the package matches vendor/name', async () => {
    mountModal()
    const input = document.body.querySelector('[data-testid="install-package-input"]') as HTMLInputElement
    input.value = 'spora-ai/spora-plugin-tavily'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const submit = document.body.querySelector('[data-testid="install-submit"]') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
  })

  it('keeps the submit button disabled when the package does not match the regex', async () => {
    mountModal()
    const input = document.body.querySelector('[data-testid="install-package-input"]') as HTMLInputElement
    input.value = 'not a package'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const submit = document.body.querySelector('[data-testid="install-submit"]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
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

  it('omits the constraint from the payload when the constraint input is empty', async () => {
    installMock.mockResolvedValueOnce({ package: 'spora-ai/spora-plugin-tavily', status: 'installed' })
    const wrapper = mountModal()
    const pkgInput = document.body.querySelector('[data-testid="install-package-input"]') as HTMLInputElement
    pkgInput.value = 'spora-ai/spora-plugin-tavily'
    pkgInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const form = document.body.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(installMock).toHaveBeenCalledWith({ package: 'spora-ai/spora-plugin-tavily' })
    expect(wrapper.emitted('installed')).toBeTruthy()
    expect(wrapper.emitted('installed')![0]).toEqual([{ package: 'spora-ai/spora-plugin-tavily' }])
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('includes the trimmed constraint in the payload when it is non-empty', async () => {
    installMock.mockResolvedValueOnce({ package: 'spora-ai/spora-plugin-tavily', status: 'installed', constraint: '^0.2' })
    const wrapper = mountModal()
    const pkgInput = document.body.querySelector('[data-testid="install-package-input"]') as HTMLInputElement
    pkgInput.value = 'spora-ai/spora-plugin-tavily'
    pkgInput.dispatchEvent(new Event('input', { bubbles: true }))
    const constraintInput = document.body.querySelector('[data-testid="install-constraint-input"]') as HTMLInputElement
    constraintInput.value = '  ^0.2  '
    constraintInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const form = document.body.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(installMock).toHaveBeenCalledWith({ package: 'spora-ai/spora-plugin-tavily', constraint: '^0.2' })
    expect(wrapper.emitted('installed')).toBeTruthy()
  })

  it('trims whitespace from the package before calling the store', async () => {
    installMock.mockResolvedValueOnce({ package: 'spora-ai/spora-plugin-tavily', status: 'installed' })
    mountModal()
    const pkgInput = document.body.querySelector('[data-testid="install-package-input"]') as HTMLInputElement
    pkgInput.value = '  spora-ai/spora-plugin-tavily  '
    pkgInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const form = document.body.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(installMock).toHaveBeenCalledWith({ package: 'spora-ai/spora-plugin-tavily' })
  })

  it('renders the submitError banner and does not emit when the store throws an ApiError', async () => {
    installMock.mockRejectedValueOnce(new ApiError('Composer failed', 'PLUGIN_INSTALL_FAILED', 500))
    const wrapper = mountModal()
    const pkgInput = document.body.querySelector('[data-testid="install-package-input"]') as HTMLInputElement
    pkgInput.value = 'spora-ai/spora-plugin-tavily'
    pkgInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const form = document.body.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    const errorBanner = document.body.querySelector('[data-testid="install-error"]')
    expect(errorBanner).not.toBeNull()
    expect(errorBanner!.textContent).toContain('Composer failed')
    expect(wrapper.emitted('installed')).toBeFalsy()
    expect(wrapper.emitted('close')).toBeFalsy()
  })

  it('renders a generic error banner when the store throws a non-ApiError', async () => {
    installMock.mockRejectedValueOnce(new Error('Boom'))
    mountModal()
    const pkgInput = document.body.querySelector('[data-testid="install-package-input"]') as HTMLInputElement
    pkgInput.value = 'spora-ai/spora-plugin-tavily'
    pkgInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const form = document.body.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    const errorBanner = document.body.querySelector('[data-testid="install-error"]')
    expect(errorBanner).not.toBeNull()
    expect(errorBanner!.textContent).toContain('Install failed.')
  })

  it('resets the form state when the modal is reopened', async () => {
    installMock.mockRejectedValueOnce(new Error('wrapped'))
    const wrapper = mountModal({ open: true })
    const pkgInput = document.body.querySelector('[data-testid="install-package-input"]') as HTMLInputElement
    pkgInput.value = 'spora-ai/spora-plugin-tavily'
    pkgInput.dispatchEvent(new Event('input', { bubbles: true }))
    const constraintInput = document.body.querySelector('[data-testid="install-constraint-input"]') as HTMLInputElement
    constraintInput.value = '^0.2'
    constraintInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const form = document.body.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.body.querySelector('[data-testid="install-error"]')).not.toBeNull()
    // Close + reopen → reset
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(document.body.querySelector('[data-testid="install-error"]')).toBeNull()
    const newPkgInput = document.body.querySelector('[data-testid="install-package-input"]') as HTMLInputElement
    const newConstraintInput = document.body.querySelector('[data-testid="install-constraint-input"]') as HTMLInputElement
    expect(newPkgInput.value).toBe('')
    expect(newConstraintInput.value).toBe('')
  })

  it('disables the submit button while the store is mutating', () => {
    mutating.value = true
    mountModal()
    const submit = document.body.querySelector('[data-testid="install-submit"]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(submit.textContent).toContain('Installing')
  })

  it('emits close when the backdrop is clicked', async () => {
    const wrapper = mountModal()
    const modal = document.body.querySelector('[data-testid="install-plugin-modal"]')?.parentElement as HTMLElement | null
    expect(modal).not.toBeNull()
    modal!.click()
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})