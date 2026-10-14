/**
 * RuntimeSettingsPage — one page of the split runtime settings.
 *
 * The fixtures mirror `GlobalSettingsController`'s wire shape: `source` is
 * always present, a secret's `value` is the literal `'***'`, and a `readonly`
 * setting is one read from the files before the database is open.
 *
 * The page no longer fetches — the layout does, once, for all five pages — so
 * each test seeds the store directly. That also lets a test mount two pages
 * against the same draft, which is the only way to check that Save is per page.
 */
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
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
const patchMock = api.patch as ReturnType<typeof vi.fn>
const deleteMock = api.delete as ReturnType<typeof vi.fn>

function setting(overrides: Partial<GlobalSetting> = {}): GlobalSetting {
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
          default: false,
          source: 'env',
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
    {
      key: 'security',
      label: 'Security',
      settings: [setting({ key: 'SPORA_MERCURE_URL', label: 'Mercure URL', value: 'https://m.test' })],
    },
    {
      key: 'worker',
      label: 'Worker',
      settings: [
        setting({ key: 'SPORA_MAX_WORKERS', label: 'Maximum workers', value: 4, source: 'env', readonly: true }),
      ],
    },
    {
      key: 'database',
      label: 'Database',
      settings: [
        setting({
          key: 'SPORA_DB_HOST',
          label: 'Database host',
          value: '127.0.0.1',
          source: 'env',
          readonly: true,
        }),
      ],
    },
  ],
  undecryptable: [],
}

const stubs = { stubs: { Icon: true } }

let wrapper: VueWrapper | undefined

async function mountPage(pageKey: 'general' | 'mail' | 'worker' | 'media', body: unknown = payload) {
  getMock.mockImplementation(async (path: string) => (path === '/admin/settings' ? body : {}))
  const store = useGlobalSettingsStore()
  await store.fetchSettings()
  wrapper = mount(RuntimeSettingsPage, { props: { pageKey }, global: stubs })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  getMock.mockReset()
  patchMock.mockReset()
  deleteMock.mockReset()
  patchMock.mockResolvedValue({ updated: [] })
  deleteMock.mockResolvedValue({ reset: [] })
  confirmMock.mockReset()
  confirmMock.mockResolvedValue(true)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

function saveButton(w: VueWrapper) {
  return w.findAll('button').find((b) => b.text() === 'Save')!
}

describe('RuntimeSettingsPage', () => {
  it('renders only the sections mapped to its page', async () => {
    const general = await mountPage('general')
    expect(general.text()).toContain('Application name')
    expect(general.text()).toContain('Allow registration')
    expect(general.text()).not.toContain('Mail password')
    general.unmount()

    const mail = await mountPage('mail')
    expect(mail.text()).toContain('Mail password')
    expect(mail.text()).toContain('Mercure URL')
    expect(mail.text()).not.toContain('Allow registration')
  })

  it('renders no control at all for a file-only setting', async () => {
    // The file-only values moved to the System page precisely because a
    // disabled input reads as something that should be editable. So this asserts
    // absence — not `disabled`, not a greyed box, nothing.
    const w = await mountPage('general')

    expect(w.text()).not.toContain('Environment')
    expect(w.find('#SPORA_APP_ENV').exists()).toBe(false)
    // And nothing on an editable page is disabled: the only reason a control
    // was ever disabled here was that it was file-only.
    expect(w.findAll('input, select, textarea').filter((n) => n.attributes('disabled') !== undefined))
      .toHaveLength(0)
  })

  it('renders a secret masked rather than as its value', async () => {
    const w = await mountPage('mail')

    expect(w.text()).toContain('Change')
    expect(w.text()).toContain('•')
    // The field is a locked display, not an input holding the mask.
    expect(w.find('#SPORA_MAIL_PASSWORD').exists()).toBe(false)
  })

  it('omits an untouched secret from the PATCH — "***" must never be sent back', async () => {
    const w = await mountPage('mail')
    // Dirty the form with an unrelated field so Save becomes available.
    await w.find('input[type="number"]').setValue('45')
    await saveButton(w).trigger('submit')
    await flushPromises()

    expect(patchMock).toHaveBeenCalledWith('/admin/settings', {
      settings: [{ group: 'framework', key: 'SPORA_TOOL_HTTP_TIMEOUT', value: '45' }],
    })
    const body = JSON.stringify(patchMock.mock.calls[0][1])
    expect(body).not.toContain('SPORA_MAIL_PASSWORD')
    expect(body).not.toContain('***')
  })

  it('sends an empty string when the operator clears a secret', async () => {
    const w = await mountPage('mail')
    await w.findAll('button').find((b) => b.text() === 'Change')!.trigger('click')
    await saveButton(w).trigger('submit')
    await flushPromises()

    expect(patchMock).toHaveBeenCalledWith('/admin/settings', {
      settings: [{ group: 'mail', key: 'SPORA_MAIL_PASSWORD', value: '' }],
    })
  })

  it('shows the worker-restart note for a worker_restart setting only', async () => {
    const w = await mountPage('mail')

    const notes = w.findAll('p').filter((p) => p.text().includes('workers restart'))
    expect(notes).toHaveLength(1)
  })

  it('marks a value that a file would otherwise supply', async () => {
    const w = await mountPage('general')

    // The chip replaces a paragraph that sat under every field with the same
    // weight as the field itself.
    expect(w.text()).toContain('.env')
    expect(w.text()).toContain('until you save here')
    expect(w.findAll('input').some((i) => i.attributes('disabled') !== undefined)).toBe(false)
  })

  it('counts only values a file supplies, not the ones still at their default', async () => {
    // Application name sits at its default and Mail password lives in the
    // database; only the registration toggle is genuinely shadowed.
    const w = await mountPage('general')

    expect(w.text()).toContain('1 value on this page is')
  })

  it('offers "Reset to default" only for a value stored in the database', async () => {
    const w = await mountPage('mail')

    expect(w.findAll('button').filter((b) => b.text() === 'Reset to default')).toHaveLength(2)
  })

  it('re-reads the registry after a reset, because the response does not carry the new value', async () => {
    const w = await mountPage('mail')
    await w.findAll('button').find((b) => b.text() === 'Reset to default')!.trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalled()
    expect(deleteMock).toHaveBeenCalledWith('/admin/settings/mail/SPORA_MAIL_PASSWORD')
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('addresses DELETE by the storage group, not the section', async () => {
    // SPORA_MAIL_PASSWORD is the one key where group === section === 'mail', so
    // the assertion above passes whether the page sends the group or the
    // section. This one cannot: the key sits in section `mail` but is stored
    // under group `framework`.
    const w = await mountPage('mail')

    let node: HTMLElement | null = w.find('#SPORA_TOOL_HTTP_TIMEOUT').element as HTMLElement
    const isReset = (b: Element) => b.textContent?.trim() === 'Reset to default'
    while (node && !Array.from(node.querySelectorAll('button')).some(isReset)) {
      node = node.parentElement
    }

    await Array.from(node!.querySelectorAll('button')).find(isReset)!.dispatchEvent(new Event('click'))
    await flushPromises()

    expect(deleteMock).toHaveBeenCalledWith('/admin/settings/framework/SPORA_TOOL_HTTP_TIMEOUT')
  })

  it('sends only its own page, and leaves another page\'s edits pending', async () => {
    // The reason saving is per page: one bar across all of them would put the
    // media page's contents into a PATCH the operator triggered on mail.
    const general = await mountPage('general')
    await general.find('button[role="switch"]').trigger('click')
    await flushPromises()
    general.unmount()

    const mail = await mountPage('mail')
    expect(saveButton(mail).attributes('disabled')).toBeDefined()
    expect(patchMock).not.toHaveBeenCalled()
  })

  it('keeps an edit made on another page when a reset re-reads the registry', async () => {
    const general = await mountPage('general')
    await general.find('button[role="switch"]').trigger('click')
    await flushPromises()
    general.unmount()

    const mail = await mountPage('mail')
    await mail.findAll('button').find((b) => b.text() === 'Reset to default')!.trigger('click')
    await flushPromises()

    // The reset re-reads, and the registration toggle is still dirty.
    expect(useGlobalSettingsStore().isPageDirty('general')).toBe(true)
    expect(patchMock).not.toHaveBeenCalled()
  })
})

describe('list settings', () => {
  const listPayload = {
    sections: [
      {
        key: 'media',
        label: 'Media',
        settings: [
          setting({
            key: 'SPORA_MEDIA_ARCHIVE_ALLOWED_IMAGE_TYPES',
            group: 'framework',
            label: 'Allowed image types',
            type: 'list',
            value: ['png', 'jpeg', 'webp'],
            default: ['png', 'jpeg', 'webp'],
          }),
        ],
      },
    ],
    undecryptable: [],
  }

  it('seeds the textarea with one item per line, not JSON', async () => {
    // JSON.stringify() also round-trips, so a round-trip assertion passes
    // either way — and it shipped, because the server splits the textarea's
    // text on whitespace without JSON-decoding it first.
    const w = await mountPage('media', listPayload)

    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('png\njpeg\nwebp')
  })

  it('sends the list as the text the operator typed', async () => {
    const w = await mountPage('media', listPayload)

    await w.find('textarea').setValue('png\njpeg\ngif')
    await saveButton(w).trigger('submit')
    await flushPromises()

    expect(patchMock).toHaveBeenCalledWith('/admin/settings', {
      settings: [
        { group: 'framework', key: 'SPORA_MEDIA_ARCHIVE_ALLOWED_IMAGE_TYPES', value: 'png\njpeg\ngif' },
      ],
    })
  })
})