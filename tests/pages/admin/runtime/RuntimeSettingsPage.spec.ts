/**
 * RuntimeSettingsPage — the shell that turns one area into a table.
 *
 * The page no longer owns an edit. It decides which sections belong to this
 * area and hands them to `SettingsTable`; the overlay owns the edit and is
 * covered by its own spec. What is left here is the filter — a setting belonging
 * to another area must not appear — and the wiring between table and overlay.
 */
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

const confirmMock = vi.fn().mockResolvedValue(true)
vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}))

import { api } from '@/api/client'
import RuntimeSettingsPage from '@/pages/admin/runtime/RuntimeSettingsPage.vue'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import type { GlobalSetting } from '@/types/globalSettings'

const getMock = api.get as ReturnType<typeof vi.fn>
const deleteMock = api.delete as ReturnType<typeof vi.fn>

function setting(overrides: Partial<GlobalSetting> = {}): GlobalSetting {
  return {
    key: 'SPORA_KEY',
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
  } as GlobalSetting
}

const payload = {
  sections: [
    {
      key: 'general',
      label: 'General',
      settings: [
        setting({ key: 'SPORA_APP_NAME', label: 'Application name', value: 'Spora' }),
        setting({ key: 'SPORA_APP_ENV', label: 'Environment', value: 'prod', source: 'env', readonly: true }),
      ],
    },
    {
      key: 'access',
      label: 'Access',
      settings: [
        setting({
          key: 'SPORA_ALLOW_REGISTRATION',
          label: 'Allow registration',
          type: 'toggle',
          value: false,
          source: 'env',
        }),
      ],
    },
    {
      key: 'mail',
      label: 'Mail',
      settings: [
        setting({ key: 'SPORA_MAIL_HOST', group: 'mail', label: 'Mail host', value: 'smtp.test', source: 'database' }),
      ],
    },
    {
      key: 'realtime',
      label: 'Realtime',
      settings: [setting({ key: 'SPORA_MERCURE_URL', label: 'Mercure URL', value: 'https://m.test' })],
    },
  ],
  undecryptable: [],
}

const stubs = { stubs: { Icon: true, Teleport: true } }

let wrapper: VueWrapper | undefined

async function mountPage(pageKey: 'general' | 'mail' | 'worker' | 'media') {
  getMock.mockImplementation(async (path: string) => (path === '/admin/settings' ? payload : {}))
  await useGlobalSettingsStore().fetchSettings()
  wrapper = mount(RuntimeSettingsPage, { props: { pageKey }, global: stubs })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  getMock.mockReset()
  deleteMock.mockReset()
  deleteMock.mockResolvedValue({ reset: [] })
  confirmMock.mockReset()
  confirmMock.mockResolvedValue(true)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('RuntimeSettingsPage', () => {
  it('shows the sections belonging to this area only', async () => {
    const general = await mountPage('general')

    expect(general.text()).toContain('Application name')
    expect(general.text()).toContain('Allow registration')
    expect(general.text()).not.toContain('Mail host')
    general.unmount()

    const mail = await mountPage('mail')
    expect(mail.text()).toContain('Mail host')
    expect(mail.text()).toContain('Mercure URL')
    expect(mail.text()).not.toContain('Allow registration')
  })

  it('leaves file-only settings off the editable areas', async () => {
    const w = await mountPage('general')

    // SPORA_APP_ENV is in the general section but file-only; it belongs on the
    // System page, so it must not appear here even though its section does.
    expect(w.text()).not.toContain('Environment')
    expect(w.text()).not.toContain('SPORA_APP_ENV')
  })

  it('names the source on every row', async () => {
    const w = await mountPage('general')

    expect(w.text()).toContain('Default')
    expect(w.text()).toContain('.env')
  })

  it('opens the section overlay from the row', async () => {
    const w = await mountPage('general')

    await w.findAll('button').find((b) => b.text() === 'Edit General')!.trigger('click')
    await flushPromises()

    expect(w.findComponent({ name: 'SectionFormDialog' }).props('section')?.key).toBe('general')
  })

  it('clears a stored value from the table, by group', async () => {
    const w = await mountPage('mail')

    await w.findAll('button').find((b) => b.text() === 'Clear')!.trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalled()
    expect(deleteMock).toHaveBeenCalledWith('/admin/settings/mail/SPORA_MAIL_HOST')
  })

  it('surfaces a load failure', async () => {
    // Set after mountPage's own mockImplementation would have overwritten it, so
    // the rejection actually reaches the store.
    getMock.mockRejectedValue(new Error('boom'))
    await useGlobalSettingsStore().fetchSettings().catch(() => {})
    wrapper = mount(RuntimeSettingsPage, { props: { pageKey: 'general' }, global: stubs })
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load global settings.')
  })
})