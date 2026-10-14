/**
 * SectionFormDialog — the per-section editor, in an overlay.
 *
 * `Modal` teleports to `document.body`, so nothing here is reachable through
 * the wrapper; the assertions query the document directly.
 *
 * The properties worth pinning are the ones the previous design had to work
 * for: a masked secret nobody touched must not be sent back as `'***'`, a field
 * nobody edited must not be captured by a save, and cancelling must send
 * nothing at all. The draft is local, so "unsaved" only ever means "unsaved in
 * this dialog".
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
import SectionFormDialog from '@/components/settings/runtime/SectionFormDialog.vue'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import type { GlobalSetting, GlobalSettingSection } from '@/types/globalSettings'

const patchMock = api.patch as ReturnType<typeof vi.fn>
const deleteMock = api.delete as ReturnType<typeof vi.fn>
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
    readonly: false,
    secret: false,
    undecryptable: false,
    applies_on: 'request',
    options: [],
    ...overrides,
  } as GlobalSetting
}

const mailSection: GlobalSettingSection = {
  key: 'mail',
  label: 'Mail',
  settings: [
    setting({ key: 'SPORA_MAIL_HOST', label: 'Mail host', value: 'smtp.example.com', source: 'env' }),
    setting({ key: 'SPORA_MAIL_PORT', label: 'Mail port', type: 'number', value: 587, source: 'env' }),
    setting({ key: 'SPORA_APP_NAME', label: 'Application name', value: 'Spora' }),
    setting({
      key: 'SPORA_MAIL_PASSWORD',
      group: 'mail',
      label: 'Mail password',
      type: 'password',
      source: 'database',
      secret: true,
      value: '***',
    }),
  ],
}

const payload = {
  sections: [mailSection],
  undecryptable: [],
}

let wrapper: VueWrapper | undefined

function dialogButtons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll('button'))
}

function buttonWithText(text: string): HTMLButtonElement {
  const found = dialogButtons().find((b) => (b.textContent ?? '').trim() === text)
  if (!found) throw new Error(`no button "${text}"`)
  return found
}

async function mountDialog(section: GlobalSettingSection = mailSection, open = true) {
  getMock.mockImplementation(async (path: string) => (path === '/admin/settings' ? payload : {}))
  await useGlobalSettingsStore().fetchSettings()
  wrapper = mount(SectionFormDialog, {
    props: { modelValue: open, section },
    global: { stubs: { Icon: true } },
    attachTo: document.body,
  })
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
  document.body.innerHTML = ''
})

describe('SectionFormDialog', () => {
  it('renders a field per setting in the section', async () => {
    await mountDialog()

    expect(document.body.textContent).toContain('Mail host')
    expect(document.body.textContent).toContain('Application name')
    expect(document.body.textContent).toContain('Mail password')

    // Three, not four: the stored password renders as a locked display rather
    // than an input, which is the behaviour asserted separately below.
    expect(document.body.querySelectorAll('input, textarea')).toHaveLength(3)
  })

  it('keeps Save unavailable until something is actually changed', async () => {
    await mountDialog()

    expect(buttonWithText('Save').disabled).toBe(true)
    expect(document.body.textContent).not.toContain('unsaved change')
  })

  it('counts the pending changes and sends only those', async () => {
    await mountDialog()
    const host = document.body.querySelector('#SPORA_MAIL_HOST') as HTMLInputElement
    host.value = 'smtp.other.test'
    host.dispatchEvent(new Event('input'))
    await flushPromises()

    expect(document.body.textContent).toContain('1 unsaved change')

    buttonWithText('Save').click()
    await flushPromises()

    expect(patchMock).toHaveBeenCalledTimes(1)
    expect(patchMock.mock.calls[0][1]).toEqual({
      settings: [{ group: 'framework', key: 'SPORA_MAIL_HOST', value: 'smtp.other.test' }],
    })
  })

  it('never sends an untouched masked secret back', async () => {
    await mountDialog()
    const port = document.body.querySelector('#SPORA_MAIL_PORT') as HTMLInputElement
    port.value = '2525'
    port.dispatchEvent(new Event('input'))
    await flushPromises()

    buttonWithText('Save').click()
    await flushPromises()

    const body = JSON.stringify(patchMock.mock.calls[0][1])
    expect(body).not.toContain('SPORA_MAIL_PASSWORD')
    expect(body).not.toContain('***')
  })

  it('sends nothing at all when cancelled', async () => {
    const w = await mountDialog()
    const host = document.body.querySelector('#SPORA_MAIL_HOST') as HTMLInputElement
    host.value = 'smtp.other.test'
    host.dispatchEvent(new Event('input'))
    await flushPromises()

    buttonWithText('Cancel').click()
    await flushPromises()

    expect(patchMock).not.toHaveBeenCalled()
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('restates the override consequence under a file-sourced field only', async () => {
    await mountDialog()
    const notes = Array.from(document.body.querySelectorAll('p'))
      .map((p) => p.textContent ?? '')
      .filter((t) => t.includes('takes precedence'))

    expect(notes).toHaveLength(2)
    expect(notes[0]).toContain('your env')

    // Application name is at its default, so there is nothing to shadow.
    expect(notes.join(' ')).not.toContain('Application name')
  })

  it('offers a way back to the files only where a stored value would be given back', async () => {
    await mountDialog()

    expect(buttonWithText('Clear stored value')).toBeDefined()
    // Only the database-sourced password qualifies.
    expect(dialogButtons().filter((b) => (b.textContent ?? '').trim() === 'Clear stored value'))
      .toHaveLength(1)
  })

  it('deletes by the storage group and re-reads, because the response does not carry the new value', async () => {
    await mountDialog()

    buttonWithText('Clear stored value').click()
    await flushPromises()

    expect(confirmMock).toHaveBeenCalled()
    expect(deleteMock).toHaveBeenCalledWith('/admin/settings/mail/SPORA_MAIL_PASSWORD')
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('shows a password field empty when no credential exists', async () => {
    // The bug this whole shape change started from: the server masks every
    // secret whether or not one is set, so a password with nothing behind it
    // rendered as `••••••••` plus a *Change* button.
    const unset = { ...mailSection, key: 'realtime', label: 'Realtime', settings: [
      setting({
        key: 'SPORA_MERCURE_JWT_KEY',
        label: 'Mercure JWT key',
        type: 'password',
        secret: true,
        source: 'default',
        value: '***',
      }),
    ] }
    await mountDialog(unset)

    const field = document.body.querySelector('#SPORA_MERCURE_JWT_KEY') as HTMLInputElement

    expect(field).not.toBeNull()
    expect(field.value).toBe('')
    expect(document.body.textContent).not.toContain('Change')
  })

  it('shows the locked mask for a secret that is actually set', async () => {
    await mountDialog()

    expect(document.body.textContent).toContain('Change')
    expect(document.body.querySelector('#SPORA_MAIL_PASSWORD')).toBeNull()
  })

  it('notes that a setting only takes effect after a worker restart', async () => {
    const withRestart = { ...mailSection, settings: [
      setting({ key: 'SPORA_MAIL_PORT', applies_on: 'worker_restart' }),
    ] }
    await mountDialog(withRestart)

    expect(document.body.textContent).toContain('Takes effect after the workers restart')
  })
})