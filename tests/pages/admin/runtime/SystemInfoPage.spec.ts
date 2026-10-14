/**
 * SystemInfoPage — the settings that live in the files.
 *
 * The point of the page is that it is not a form. A disabled control looks
 * editable and is not, so these assertions are mostly about the absence of
 * controls, and about a secret being reported as a state rather than as `'***'`
 * — the mask reaches the client whether a credential exists or not, so a page
 * that showed it would tell an operator nothing.
 */
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}))

import { api } from '@/api/client'
import SystemInfoPage from '@/pages/admin/runtime/SystemInfoPage.vue'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import type { GlobalSetting } from '@/types/globalSettings'

const getMock = api.get as ReturnType<typeof vi.fn>

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
    readonly: true,
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
      key: 'database',
      label: 'Database',
      settings: [
        setting({ key: 'SPORA_DB_HOST', label: 'Database host', value: '127.0.0.1', source: 'env' }),
        setting({ key: 'SPORA_DB_PORT', label: 'Database port', value: '3306', source: 'env' }),
        setting({ key: 'SPORA_DB_USER', label: 'Database user', value: '', source: 'default' }),
        setting({
          key: 'SPORA_DB_PASSWORD',
          label: 'Database password',
          source: 'env',
          secret: true,
          value: '***',
        }),
        setting({
          key: 'SPORA_KEY_PATH',
          label: 'Secret key path',
          source: 'database',
          secret: true,
          undecryptable: true,
          value: '***',
        }),
        setting({ key: 'SPORA_DB_DRIVER', label: 'Database driver', value: 'sqlite', type: 'select' }),
      ],
    },
    {
      key: 'general',
      label: 'General',
      settings: [
        setting({ key: 'SPORA_LOG_LEVEL', label: 'Log level', value: 'DEBUG', source: 'env' }),
        // Editable, so it belongs on a form page and must not appear here.
        setting({ key: 'SPORA_APP_NAME', label: 'Application name', value: 'Spora', readonly: false }),
      ],
    },
  ],
  undecryptable: ['SPORA_KEY_PATH'],
}

let wrapper: VueWrapper | undefined

async function mountPage() {
  getMock.mockImplementation(async (path: string) => (path === '/admin/settings' ? payload : {}))
  await useGlobalSettingsStore().fetchSettings()
  wrapper = mount(SystemInfoPage, { global: { stubs: { Icon: true } } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  getMock.mockReset()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('SystemInfoPage', () => {
  it('renders no form control anywhere', async () => {
    const w = await mountPage()

    expect(w.findAll('input, select, textarea, button')).toHaveLength(0)
  })

  it('shows every file-only setting, with its key', async () => {
    const w = await mountPage()

    expect(w.text()).toContain('Database host')
    expect(w.text()).toContain('SPORA_DB_HOST')
    expect(w.text()).toContain('Log level')
  })

  it('leaves an editable setting out', async () => {
    const w = await mountPage()

    expect(w.text()).not.toContain('Application name')
  })

  it('reports a secret as a state and never as the mask', async () => {
    const w = await mountPage()
    const text = w.text()

    // Set from a file, and set but unreadable — the mask reads `***` for both.
    expect(text).toContain('Set (from env)')
    expect(text).toContain('Set, but unreadable')
    expect(text).not.toContain('***')
  })

  it('names an unset value instead of leaving a blank cell', async () => {
    const w = await mountPage()

    expect(w.text()).toContain('Not set')
  })

  it('says an unreadable secret needs re-entering, on the row itself', async () => {
    const w = await mountPage()

    // Not the banner the editable pages use, and deliberately: that one tells
    // the operator to set the key again *here*, which is exactly what this page
    // cannot do. The row carries the instruction instead.
    expect(w.text()).toContain('Set, but unreadable — set it again')
    expect(w.text()).toContain('SPORA_KEY_PATH')
    expect(w.text()).not.toContain('Set them again here')
  })

  it('shows the value rather than a control for every non-secret', async () => {
    const w = await mountPage()

    expect(w.text()).toContain('127.0.0.1')
    expect(w.text()).toContain('3306')
    expect(w.text()).toContain('sqlite')
  })
})