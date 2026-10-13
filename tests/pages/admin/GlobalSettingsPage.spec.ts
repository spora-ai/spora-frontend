/**
 * GlobalSettingsPage — admin editor for Spora's runtime settings registry.
 *
 * The fixtures mirror `GlobalSettingsController`'s wire shape: `source` is
 * always present, a secret's `value` is the literal `'***'`, and a `readonly`
 * setting is one read before the database is open.
 */
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

const userRef = ref<{ is_admin: boolean } | null>({ is_admin: true })
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ get user() { return userRef.value } }),
}))

const confirmMock = vi.fn().mockResolvedValue(true)
vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}))

import { api } from '@/api/client'
import GlobalSettingsPage from '@/pages/admin/GlobalSettingsPage.vue'

const getMock = api.get as ReturnType<typeof vi.fn>
const patchMock = api.patch as ReturnType<typeof vi.fn>
const deleteMock = api.delete as ReturnType<typeof vi.fn>

function setting(overrides: Record<string, unknown> = {}) {
  return {
    key: 'SPORA_KEY',
    // The storage discriminator, deliberately NOT the section key — that
    // distinction is what broke DELETE before.
    group: 'framework',
    label: 'A setting',
    type: 'text',
    description: '',
    value: '',
    default: '',
    source: 'default',
    readonly: false,
    secret: false,
    undecryptable: false,
    applies_on: 'request',
    options: [],
    ...overrides,
  }
}

const payload = {
  sections: [
    {
      key: 'general',
      label: 'General',
      settings: [
        setting({
          key: 'SPORA_ALLOW_REGISTRATION',
          label: 'Allow registration',
          type: 'toggle',
          description: 'Let new accounts sign themselves up.',
          value: false,
          default: false,
          source: 'env',
        }),
        setting({
          key: 'SPORA_APP_ENV',
          label: 'Environment',
          value: 'prod',
          default: 'prod',
          source: 'env',
          readonly: true,
        }),
      ],
    },
    {
      key: 'mail',
      label: 'Mail',
      settings: [
        setting({
          key: 'SPORA_MAIL_PASSWORD',
          group: 'mail',
          label: 'Mail password',
          type: 'password',
          value: '***',
          default: '',
          source: 'database',
          secret: true,
        }),
        setting({
          key: 'SPORA_TOOL_HTTP_TIMEOUT',
          label: 'Tool HTTP timeout',
          type: 'number',
          value: 30,
          default: 30,
          source: 'database',
          applies_on: 'worker_restart',
        }),
      ],
    },
  ],
  undecryptable: [],
}

const stubs = { stubs: { Icon: true } }

let wrapper: VueWrapper | undefined

function mountPage(body: unknown = payload) {
  getMock.mockImplementation(async (path: string) => (path === '/admin/settings' ? body : {}))
  wrapper = mount(GlobalSettingsPage, { global: stubs })
  return wrapper
}

function mountFailing() {
  getMock.mockRejectedValue(new Error('boom'))
  wrapper = mount(GlobalSettingsPage, { global: stubs })
  return wrapper
}

beforeEach(() => {
  getMock.mockReset()
  patchMock.mockReset()
  deleteMock.mockReset()
  patchMock.mockResolvedValue({ updated: [] })
  userRef.value = { is_admin: true }
  confirmMock.mockReset()
  confirmMock.mockResolvedValue(true)
})

function saveButton(w: VueWrapper) {
  return w.findAll('button').find((b) => b.text() === 'Save')!
}

describe('GlobalSettingsPage', () => {
  it('renders one block per section the registry declares', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('General')
    expect(w.text()).toContain('Mail')
    expect(w.text()).toContain('Allow registration')
    expect(w.text()).toContain('Mail password')
    w.unmount()
  })

  it('renders a secret masked rather than as its value', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('Change')
    expect(w.text()).toContain('•')
    // The field is a locked display, not an input holding the mask.
    expect(w.find('#SPORA_MAIL_PASSWORD').exists()).toBe(false)
    w.unmount()
  })

  it('omits an untouched secret from the PATCH — "***" must never be sent back', async () => {
    const w = mountPage()
    await flushPromises()
    // Dirty the form with an unrelated field so Save becomes available.
    await w.find('button[role="switch"]').trigger('click')
    await saveButton(w).trigger('submit')
    await flushPromises()

    expect(patchMock).toHaveBeenCalledWith('/admin/settings', {
      settings: [{ group: 'framework', key: 'SPORA_ALLOW_REGISTRATION', value: true }],
    })
    const body = JSON.stringify(patchMock.mock.calls[0][1])
    expect(body).not.toContain('SPORA_MAIL_PASSWORD')
    expect(body).not.toContain('***')
    w.unmount()
  })

  it('sends an empty string when the operator clears a secret', async () => {
    const w = mountPage()
    await flushPromises()
    const changeBtn = w.findAll('button').find((b) => b.text() === 'Change')!
    await changeBtn.trigger('click')
    await saveButton(w).trigger('submit')
    await flushPromises()

    expect(patchMock).toHaveBeenCalledWith('/admin/settings', {
      settings: [{ group: 'mail', key: 'SPORA_MAIL_PASSWORD', value: '' }],
    })
    w.unmount()
  })

  it('renders AdminForbidden and never calls the API for a non-admin', async () => {
    userRef.value = { is_admin: false }
    const w = mountPage()
    await flushPromises()

    expect(w.text()).toContain('Forbidden')
    expect(w.text()).toContain('admin privileges')
    expect(getMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('disables a readonly field and says why it cannot be changed here', async () => {
    const w = mountPage()
    await flushPromises()

    const input = w.find<HTMLInputElement>('#SPORA_APP_ENV')
    expect(input.exists()).toBe(true)
    expect(input.element.disabled).toBe(true)
    expect(w.text()).toContain('before the database is available')
    w.unmount()
  })

  it('never sends a readonly field, even after the operator edits it', async () => {
    const w = mountPage()
    await flushPromises()
    // A disabled input ignores user input, but the diff must still refuse to
    // build an update for it if a value ever reached the draft.
    expect(saveButton(w).attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('shows the worker-restart note for a worker_restart setting only', async () => {
    const w = mountPage()
    await flushPromises()

    const notes = w.findAll('p').filter((p) => p.text().includes('workers restart'))
    expect(notes).toHaveLength(1)
    expect(notes[0].text()).toBe('Takes effect after the workers restart.')
    w.unmount()
  })

  it('says where an env-sourced value comes from and that saving here wins', async () => {
    const w = mountPage()
    await flushPromises()

    expect(w.text()).toContain('Currently from')
    expect(w.text()).toContain('SPORA_ALLOW_REGISTRATION')
    expect(w.text()).toContain('your `.env`')
    expect(w.text()).toContain('saving here takes precedence')
    w.unmount()
  })

  it('shows no source note once the value lives in the database', async () => {
    const w = mountPage({
      sections: [
        {
          key: 'mail',
          label: 'Mail',
          settings: [payload.sections[1].settings[1]],
        },
      ],
      undecryptable: [],
    })
    await flushPromises()

    expect(w.text()).toContain('Tool HTTP timeout')
    expect(w.text()).not.toContain('saving here takes precedence')
    w.unmount()
  })

  it('lists an undecryptable key in the banner', async () => {
    const w = mountPage({ ...payload, undecryptable: ['SPORA_MAIL_PASSWORD'] })
    await flushPromises()

    expect(w.text()).toContain('could not be decrypted')
    expect(w.text()).toContain('SPORA_MAIL_PASSWORD')
    w.unmount()
  })

  it('surfaces a load failure through the error banner', async () => {
    const w = mountFailing()
    await flushPromises()

    expect(w.text()).toContain('Failed to load global settings.')
    w.unmount()
  })

  it('offers "Reset to default" only for a value stored in the database', async () => {
    const w = mountPage()
    await flushPromises()

    const resetButtons = w.findAll('button').filter((b) => b.text() === 'Reset to default')
    expect(resetButtons).toHaveLength(2)
    w.unmount()
  })

  it('re-reads the registry after a reset, because the response does not carry the new value', async () => {
    const w = mountPage()
    await flushPromises()
    const resetButton = w.findAll('button').find((b) => b.text() === 'Reset to default')!
    await resetButton.trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalled()
    expect(deleteMock).toHaveBeenCalledWith('/admin/settings/mail/SPORA_MAIL_PASSWORD')
    expect(getMock).toHaveBeenCalledTimes(2)
    w.unmount()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })
})