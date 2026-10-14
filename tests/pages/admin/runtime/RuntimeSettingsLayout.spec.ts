/**
 * RuntimeSettingsLayout — the frame around the five settings pages.
 *
 * It owns the admin gate and the single fetch. Both used to belong to
 * GlobalSettingsPage, and both were tested there: the forbidden case and the
 * load-failure banner. They live here now, so they are asserted here — a
 * layout that renders its children for a non-admin would show a form the server
 * refuses to act on.
 */
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
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

import { api } from '@/api/client'
import RuntimeSettingsLayout from '@/pages/admin/runtime/RuntimeSettingsLayout.vue'
import { useGlobalSettingsStore } from '@/stores/globalSettings'

const getMock = api.get as ReturnType<typeof vi.fn>

const payload = {
  sections: [
    {
      key: 'access',
      label: 'Access',
      settings: [{
        key: 'SPORA_ALLOW_REGISTRATION',
        group: 'framework',
        label: 'Allow registration',
        type: 'toggle',
        description: '',
        value: false,
        default: false,
        source: 'env',
        readonly: false,
        secret: false,
        undecryptable: false,
        applies_on: 'request',
        options: [],
      }],
    },
    {
      key: 'mail',
      label: 'Mail',
      settings: [{
        key: 'SPORA_MAIL_HOST',
        group: 'mail',
        label: 'Mail host',
        type: 'text',
        description: '',
        value: 'smtp.test',
        default: '',
        source: 'default',
        readonly: false,
        secret: false,
        undecryptable: false,
        applies_on: 'request',
        options: [],
      }],
    },
  ],
  undecryptable: [],
}

// The tab labels live inside `<RouterLink>`, and the default `true` stub drops
// the slot — which renders the sub-navigation as an empty bar.
const stubs = {
  stubs: {
    Icon: true,
    RouterLink: { template: '<a><slot /></a>' },
    RouterView: true,
  },
}

let wrapper: VueWrapper | undefined

function mountLayout() {
  wrapper = mount(RuntimeSettingsLayout, { global: stubs })
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  getMock.mockReset()
  getMock.mockImplementation(async (path: string) => (path === '/admin/settings' ? payload : {}))
  userRef.value = { is_admin: true }
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('RuntimeSettingsLayout', () => {
  it('renders AdminForbidden and never calls the API for a non-admin', async () => {
    userRef.value = { is_admin: false }
    const w = mountLayout()
    await flushPromises()

    expect(w.text()).toContain('Forbidden')
    expect(w.text()).toContain('admin privileges')
    expect(getMock).not.toHaveBeenCalled()
  })

  it('fetches once for every page rather than once per page', async () => {
    const w = mountLayout()
    await flushPromises()
    wrapper?.unmount()

    mountLayout()
    await flushPromises()

    // Two mounts of the layout: the second finds the store already populated.
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a load failure', async () => {
    getMock.mockRejectedValue(new Error('boom'))
    const w = mountLayout()
    await flushPromises()

    expect(useGlobalSettingsStore().error).not.toBeNull()
  })

  it('lists all five pages in the sub-navigation', async () => {
    const w = mountLayout()
    await flushPromises()

    for (const label of ['General', 'Mail & Realtime', 'Worker & Performance', 'Media & Plugins', 'System']) {
      expect(w.text()).toContain(label)
    }
  })

  it('marks a page with unsaved work and counts them in total', async () => {
    const store = useGlobalSettingsStore()
    await store.fetchSettings()
    const w = mountLayout()
    await flushPromises()

    store.setDraftValue('access', store.sections[0].settings[0], true)
    await flushPromises()

    expect(store.dirtyPageKeys).toEqual(['general'])
    expect(w.findAll('[aria-label="unsaved changes"]')).toHaveLength(1)
    expect(w.text()).toContain('1 unsaved change across the runtime settings')
    expect(w.text()).toContain('Saving is per page')
  })
})