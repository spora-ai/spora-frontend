/**
 * SettingsPluginsPage — the Plugins tab.
 *
 * The page is a shell: it splits the registry's `plugins` section into the
 * groups the settings are stored under and hands each group to the table and
 * the overlay the admin runtime pages use. What is left to assert here is the
 * split, the masking of a secret, and the fact that the plugin settings are
 * no longer rendered by the admin runtime area.
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

const toastMock = { success: vi.fn(), error: vi.fn() }
vi.mock('@/composables/useToast', () => ({
  useToast: () => toastMock,
}))

import { api } from '@/api/client'
import SettingsPluginsPage from '@/pages/settings/SettingsPluginsPage.vue'
import SettingsTable from '@/components/settings/runtime/SettingsTable.vue'
import { useAuthStore } from '@/stores/auth'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import type { GlobalSetting, GlobalSettingsPayload } from '@/types/globalSettings'

const getMock = api.get as ReturnType<typeof vi.fn>
const patchMock = api.patch as ReturnType<typeof vi.fn>
const deleteMock = api.delete as ReturnType<typeof vi.fn>

/**
 * The tab is an admin surface, so the page is exercised as one: a plugin's
 * settings are install-wide, and some of them are the OAuth client secrets of
 * the whole installation.
 */
function signInAs(isAdmin: boolean): void {
  useAuthStore().user = {
    id: 1,
    email: 'admin@example.test',
    username: 'admin',
    name: 'Admin',
    is_admin: isAdmin,
    roles: isAdmin ? ['ADMIN'] : [],
    verified: true,
  }
}

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
    options: [],
    ...overrides,
  } as GlobalSetting
}

const coreSettings = [
  setting({ key: 'SPORA_PLUGIN_INSTALL_ENABLED', label: 'Allow plugin installation', type: 'toggle', value: false }),
  setting({ key: 'SPORA_PLUGIN_CATALOG_ENABLED', label: 'Plugin catalog', type: 'toggle', value: true }),
  setting({ key: 'SPORA_PLUGIN_CATALOG_TTL', label: 'Catalog cache lifetime', type: 'number', value: 3600 }),
  setting({ key: 'SPORA_COMPOSER_BINARY', label: 'Composer binary', value: 'composer' }),
]

const socialSettings = [
  setting({
    key: 'SPORA_SOCIAL_LINKEDIN_CLIENT_ID',
    group: 'plugin:social',
    label: 'LinkedIn client id',
    value: 'abc123',
    source: 'database',
  }),
  setting({
    key: 'SPORA_SOCIAL_CLIENT_SECRET',
    group: 'plugin:social',
    label: 'Client secret',
    // A plugin may declare a secret as any type; the field masks it either
    // way, because the payload carries the literal `'***'`.
    type: 'text',
    secret: true,
    value: '***',
    source: 'database',
  }),
]

function payload(
  settings: GlobalSetting[] = [...coreSettings, ...socialSettings],
  undecryptable: string[] = [],
): GlobalSettingsPayload {
  return {
    sections: [{ key: 'plugins', label: 'Plugins', settings }],
    undecryptable,
  }
}

function buttonWithText(text: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll('button'))
    .find((b) => (b.textContent ?? '').trim() === text)
  if (!found) throw new Error(`no button "${text}"`)
  return found
}

let wrapper: VueWrapper | undefined

async function mountPage(settings?: GlobalSetting[], undecryptable?: string[]) {
  getMock.mockImplementation(async (path: string) => (path === '/admin/settings' ? payload(settings, undecryptable) : {}))
  await useGlobalSettingsStore().fetchSettings()
  // The call above is the fixture. The page's own request is what the
  // non-admin case asserts on.
  getMock.mockClear()
  wrapper = mount(SettingsPluginsPage, { global: { stubs: { Icon: true } } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  signInAs(true)
  getMock.mockReset()
  patchMock.mockReset()
  deleteMock.mockReset()
  patchMock.mockResolvedValue({ updated: [] })
  deleteMock.mockResolvedValue({ reset: [] })
  confirmMock.mockReset()
  confirmMock.mockResolvedValue(true)
  toastMock.success.mockReset()
  toastMock.error.mockReset()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

describe('SettingsPluginsPage', () => {
  it('shows the forbidden state to a non-admin, and asks for nothing', async () => {
    signInAs(false)
    const w = await mountPage()

    expect(w.text()).toContain('Forbidden')
    // The registry would answer 403 for this user anyway, and a request that
    // is bound to fail is a request an admin's browser should not make.
    expect(getMock).not.toHaveBeenCalled()
  })

  it('renders the plugin system settings on the tab', async () => {
    const w = await mountPage()

    expect(w.text()).toContain('Allow plugin installation')
    expect(w.text()).toContain('Plugin catalog')
    expect(w.text()).toContain('Catalog cache lifetime')
    expect(w.text()).toContain('Composer binary')
  })

  it('groups a plugin contributed settings under that plugin', async () => {
    const w = await mountPage()

    const groups = w.findComponent(SettingsTable).props('sections') as Array<{
      key: string
      label: string
      settings: GlobalSetting[]
    }>

    expect(groups.map((g) => g.key)).toEqual(['framework', 'plugin:social'])
    expect(groups[0]?.label).toBe('Plugin system')
    expect(groups[1]?.label).toBe('Social')
    // The plugin's own settings, and only the plugin's own settings.
    expect(groups[1]?.settings.map((s) => s.key)).toEqual([
      'SPORA_SOCIAL_LINKEDIN_CLIENT_ID',
      'SPORA_SOCIAL_CLIENT_SECRET',
    ])
    expect(w.text()).toContain('LinkedIn client id')
  })

  it('adds no group for a plugin that contributed no settings', async () => {
    const w = await mountPage(coreSettings)

    const groups = w.findComponent(SettingsTable).props('sections') as Array<{ key: string }>

    expect(groups).toHaveLength(1)
    expect(groups[0]?.key).toBe('framework')
  })

  it('masks a secret and never sends it back', async () => {
    const w = await mountPage()

    await w.findAll('button').find((b) => b.text() === 'Edit Social')!.trigger('click')
    await flushPromises()

    // A locked display, not a field holding the mask: the payload carries the
    // literal `'***'` in place of the value, and a text field would show
    // those three characters as if they were the credential.
    expect(document.body.querySelector('#SPORA_SOCIAL_CLIENT_SECRET')).toBeNull()
    expect(document.body.textContent).toContain('Change')
    expect(document.body.textContent).not.toContain('***')

    const clientId = document.body.querySelector('#SPORA_SOCIAL_LINKEDIN_CLIENT_ID') as HTMLInputElement
    clientId.value = 'other'
    clientId.dispatchEvent(new Event('input'))
    await flushPromises()

    buttonWithText('Save').click()
    await flushPromises()

    const body = JSON.stringify(patchMock.mock.calls[0][1])
    expect(body).toContain('SPORA_SOCIAL_LINKEDIN_CLIENT_ID')
    expect(body).not.toContain('SPORA_SOCIAL_CLIENT_SECRET')
    expect(body).not.toContain('***')
  })

  it('saves a plugin setting under the group it is stored in', async () => {
    const w = await mountPage()

    await w.findAll('button').find((b) => b.text() === 'Edit Social')!.trigger('click')
    await flushPromises()

    const clientId = document.body.querySelector('#SPORA_SOCIAL_LINKEDIN_CLIENT_ID') as HTMLInputElement
    clientId.value = 'other'
    clientId.dispatchEvent(new Event('input'))
    await flushPromises()

    buttonWithText('Save').click()
    await flushPromises()

    expect(patchMock.mock.calls[0][1]).toEqual({
      settings: [{ group: 'plugin:social', key: 'SPORA_SOCIAL_LINKEDIN_CLIENT_ID', value: 'other' }],
    })
  })

  it('clears a stored plugin setting by the group it is stored in', async () => {
    const w = await mountPage()

    await w.findAll('button').find((b) => b.text() === 'Clear')!.trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalled()
    // The group, not the section: the setting is stored under `plugin:social`
    // while it is shown in the `plugins` section.
    expect(deleteMock).toHaveBeenCalledWith('/admin/settings/plugin%3Asocial/SPORA_SOCIAL_LINKEDIN_CLIENT_ID')
  })

  it('names the plugin credentials that could not be decrypted', async () => {
    // The plugin settings live only on this tab, so the page that owns them
    // is where the operator is told that one of them is running on its
    // default.
    const w = await mountPage(undefined, ['SPORA_SOCIAL_CLIENT_SECRET'])

    expect(w.text()).toContain('These settings could not be decrypted')
    expect(w.text()).toContain('SPORA_SOCIAL_CLIENT_SECRET')
  })

  it('names no key that belongs to another page', async () => {
    // The undecryptable list is global — it names every key in the registry
    // that could not be decrypted — so the banner is narrowed to the keys
    // this tab owns.
    const w = await mountPage(undefined, ['SPORA_MAIL_PASSWORD'])

    expect(w.text()).not.toContain('These settings could not be decrypted')
  })

  it('surfaces a load failure', async () => {
    getMock.mockRejectedValue(new Error('boom'))
    await useGlobalSettingsStore().fetchSettings().catch(() => {})
    wrapper = mount(SettingsPluginsPage, { global: { stubs: { Icon: true } } })
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load global settings.')
  })
})
