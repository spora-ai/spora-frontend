/**
 * SystemInfoPage — the file-only settings, rendered with the same table as the
 * editable areas.
 *
 * Using one table is the point: a second shape for "read-only" would mean two
 * places where a value is rendered, and they would drift.
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
          label: 'Secret key file',
          source: 'database',
          secret: true,
          undecryptable: true,
          value: '***',
        }),
      ],
    },
    {
      key: 'general',
      label: 'General',
      settings: [
        setting({ key: 'SPORA_APP_ENV', label: 'Environment', value: 'production', source: 'env' }),
        // Editable, so it belongs on an area page.
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

  it('shows the file-only settings and leaves the editable ones out', async () => {
    const w = await mountPage()

    expect(w.text()).toContain('Database host')
    expect(w.text()).toContain('SPORA_DB_HOST')
    expect(w.text()).toContain('Environment')
    expect(w.text()).not.toContain('Application name')
  })

  it('names the source on every row', async () => {
    const w = await mountPage()

    expect(w.text()).toContain('.env')
    expect(w.text()).toContain('Database')
    expect(w.text()).toContain('Default')
  })

  it('reports a secret as a state, never as the mask', async () => {
    const w = await mountPage()

    expect(w.text()).toContain('Set (from env)')
    expect(w.text()).toContain('Set, but unreadable')
    expect(w.text()).not.toContain('***')
  })

  it('marks every row as file-only rather than offering an edit', async () => {
    const w = await mountPage()

    expect(w.findAll('tbody tr')).toHaveLength(5)
    expect(w.text().match(/file only/g)).toHaveLength(5)
  })
})