/**
 * MediaPickerOverlay — tests list/search/pagination/upload flow.
 *
 * Modal slots are teleported to `<body>`, so we query the DOM directly
 * (mirroring `tests/components/Modal.spec.ts`). VTU's `wrapper.find()` does
 * NOT cross Teleport boundaries.
 *
 * JSDOM does NOT run Vue's `@click` handlers when calling element.click()
 * directly — the listener-bound function is hooked differently. We use
 * `dispatchEvent(new MouseEvent('click'))` so the event passes through Vue's
 * listener chain.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    postForm: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/api/client', () => ({
  default: apiMock,
  api: apiMock,
  ApiError: class ApiError extends Error {
    status = 0
    code = 'TEST'
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

const IconStub = {
  name: 'Icon',
  props: ['name'],
  template: '<span class="icon-stub" :data-name="name" />',
}

import MediaPickerOverlay, { type MediaAsset } from '@/components/MediaPickerOverlay.vue'

function makeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'asset-1',
    filename: 'note.txt',
    media_type: 'document',
    mime_type: 'text/plain',
    byte_size: 1024,
    asset_url: null,
    has_markdown: true,
    ...overrides,
  }
}

function makeListResponse(overrides: Partial<{ assets: MediaAsset[]; page: number; lastPage: number; total: number }> = {}) {
  return {
    assets: [makeAsset()],
    page: 1,
    perPage: 24,
    total: 1,
    lastPage: 1,
    ...overrides,
  }
}

function clickEl(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function triggerChange(el: HTMLInputElement, value: string): void {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Mount the picker closed, then flip modelValue to true so the
 *  watch-based loader fires. Returns wrapper + a settled DOM. */
async function mountAndSettle(props: Record<string, unknown> = {}, listResponse: unknown = makeListResponse({ assets: [], lastPage: 1, total: 0 })) {
  apiMock.get.mockResolvedValueOnce(listResponse)
  const wrapper = mount(MediaPickerOverlay, {
    props: { modelValue: false, agentId: 1, ...props },
    global: { stubs: { Icon: IconStub } },
    attachTo: document.body,
  })
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  apiMock.get.mockReset()
  apiMock.postForm.mockReset()
  apiMock.post.mockReset()
})

describe('MediaPickerOverlay', () => {
  it('renders no inner content until modelValue is true', () => {
    const wrapper = mount(MediaPickerOverlay, {
      props: { modelValue: false, agentId: 1 },
      global: { stubs: { Icon: IconStub } },
      attachTo: document.body,
    })
    expect(document.body.querySelector('[data-testid="media-picker-skeleton"]')).toBeFalsy()
    expect(document.body.querySelector('[data-testid="media-picker-grid"]')).toBeFalsy()
    wrapper.unmount()
  })

  it('fetches the first page with ownership=mine and types=image,document on open', async () => {
    const wrapper = await mountAndSettle({ agentId: 7, mediaKind: 'image+document' })
    expect(apiMock.get).toHaveBeenCalledTimes(1)
    const url = apiMock.get.mock.calls[0][0] as string
    // Default source mode is 'all', which uses the union semantic —
    // backend filter `ownership=mine` (not the legacy `scope=mine`).
    expect(url).toContain('ownership=mine')
    expect(url).not.toContain('scope=')
    expect(url).toContain('types=image%2Cdocument')
    expect(url).toContain('page=1')
    expect(url).toContain('per_page=24')
    // agent_id is NEVER sent on the list endpoint per the picker
    // caller contract (provenance lives on uploads, not queries).
    expect(url).not.toContain('agent_id')
    wrapper.unmount()
  })

  it('sends types=image when mediaKind="image"', async () => {
    const wrapper = await mountAndSettle({ mediaKind: 'image' })
    const url = apiMock.get.mock.calls[0][0] as string
    expect(url).toContain('types=image')
    expect(url).not.toContain('document')
    wrapper.unmount()
  })

  it('renders the empty state when the grid comes back empty', async () => {
    const wrapper = await mountAndSettle({}, makeListResponse({ assets: [], lastPage: 1, total: 0 }))
    expect(document.body.querySelector('[data-testid="media-picker-empty"]')).toBeTruthy()
    wrapper.unmount()
  })

  it('renders one card per asset', async () => {
    const assets = [
      makeAsset({ id: 'a', filename: 'a.txt' }),
      makeAsset({ id: 'b', filename: 'b.txt' }),
      makeAsset({ id: 'c', filename: 'c.png', media_type: 'image', mime_type: 'image/png', asset_url: '/api/v1/assets/c.png' }),
    ]
    const wrapper = await mountAndSettle({}, makeListResponse({ assets, lastPage: 1, total: 3 }))
    expect(document.body.querySelectorAll('[data-testid^="media-picker-card-"]')).toHaveLength(3)
    expect(document.body.querySelector('[data-testid="media-picker-card-a"]')?.textContent ?? '').toContain('a.txt')
    wrapper.unmount()
  })

  it('debounces search and re-fetches with q on page 1', async () => {
    const wrapper = await mountAndSettle({}, makeListResponse({ assets: [], lastPage: 1, total: 0 }))
    apiMock.get.mockClear()
    const search = document.body.querySelector('[data-testid="media-picker-search"] input') as HTMLInputElement
    expect(search).toBeTruthy()
    triggerChange(search, 'invoice')
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()
    expect(apiMock.get).toHaveBeenCalledTimes(1)
    const url = apiMock.get.mock.calls[0][0] as string
    expect(url).toContain('q=invoice')
    wrapper.unmount()
  })

  it('appends the next page on Load more', async () => {
    const first = makeListResponse({ assets: [makeAsset({ id: 'a' })], page: 1, lastPage: 2, total: 2 })
    const second = makeListResponse({ assets: [makeAsset({ id: 'b' })], page: 2, lastPage: 2, total: 2 })
    const wrapper = await mountAndSettle({}, first)
    apiMock.get.mockResolvedValueOnce(second)
    const moreBtn = document.body.querySelector('[data-testid="media-picker-load-more"]') as HTMLButtonElement
    expect(moreBtn).toBeTruthy()
    clickEl(moreBtn)
    await flushPromises()
    expect(apiMock.get).toHaveBeenCalledTimes(2)
    const secondUrl = apiMock.get.mock.calls[1][0] as string
    expect(secondUrl).toContain('page=2')
    expect(document.body.querySelectorAll('[data-testid^="media-picker-card-"]')).toHaveLength(2)
    wrapper.unmount()
  })

  it('hides the Load more button on the last page', async () => {
    const wrapper = await mountAndSettle({}, makeListResponse({ assets: [makeAsset()], page: 1, lastPage: 1, total: 1 }))
    expect(document.body.querySelector('[data-testid="media-picker-load-more"]')).toBeFalsy()
    wrapper.unmount()
  })

  it('emits attach + closes when selections are confirmed', async () => {
    const a = makeAsset({ id: 'a' })
    const b = makeAsset({ id: 'b' })
    const wrapper = await mountAndSettle({}, makeListResponse({ assets: [a, b], lastPage: 1, total: 2 }))
    clickEl(document.body.querySelector('[data-testid="media-picker-card-a"]') as HTMLElement)
    clickEl(document.body.querySelector('[data-testid="media-picker-card-b"]') as HTMLElement)
    await flushPromises()
    const attachBtn = document.body.querySelector('[data-testid="media-picker-attach"]') as HTMLButtonElement
    expect(attachBtn).toBeTruthy()
    clickEl(attachBtn)
    expect(wrapper.emitted('attach')?.[0]).toEqual([[a, b]])
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('toggles the data-selected flag on a card click', async () => {
    const wrapper = await mountAndSettle({}, makeListResponse({ assets: [makeAsset({ id: 'a' })], lastPage: 1, total: 1 }))
    const card = document.body.querySelector('[data-testid="media-picker-card-a"]') as HTMLElement
    expect(card.getAttribute('data-selected')).toBe('false')
    clickEl(card)
    await flushPromises()
    expect((document.body.querySelector('[data-testid="media-picker-card-a"]') as HTMLElement).getAttribute('data-selected')).toBe('true')
    wrapper.unmount()
  })

  it('uploads the picked file via postForm with agent_id and emits attach', async () => {
    const wrapper = await mountAndSettle({ agentId: 42 }, makeListResponse({ assets: [], lastPage: 1, total: 0 }))
    const uploaded: MediaAsset = makeAsset({ id: 'u-1', filename: 'fresh.txt', byte_size: 12 })
    apiMock.postForm.mockReset()
    apiMock.postForm.mockResolvedValueOnce(uploaded)
    const uploadInput = document.body.querySelector('[data-testid="media-picker-upload-input"]') as HTMLInputElement
    expect(uploadInput).toBeTruthy()
    const file = new File(['x'], 'fresh.txt', { type: 'text/plain' })
    Object.defineProperty(uploadInput, 'files', { value: [file] })
    uploadInput.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()
    expect(apiMock.postForm).toHaveBeenCalledTimes(1)
    const [path, form] = apiMock.postForm.mock.calls[0]
    expect(path).toBe('/media')
    expect(form.get('file')).toBe(file)
    expect(form.get('agent_id')).toBe('42')
    expect(wrapper.emitted('attach')?.[0]).toEqual([[uploaded]])
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('forwards the accept prop to the hidden file input', async () => {
    const wrapper = await mountAndSettle({ accept: '.txt' }, makeListResponse({ assets: [], lastPage: 1, total: 0 }))
    const uploadInput = document.body.querySelector('[data-testid="media-picker-upload-input"]') as HTMLInputElement
    expect(uploadInput.accept).toBe('.txt')
    wrapper.unmount()
  })

  it('surfaces the ApiError message verbatim and keeps the modal open on upload failure', async () => {
    const wrapper = await mountAndSettle({}, makeListResponse({ assets: [], lastPage: 1, total: 0 }))
    const { ApiError } = await import('@/api/client')
    apiMock.postForm.mockReset()
    apiMock.postForm.mockRejectedValueOnce(new ApiError('Rejected file (HTTP 415)'))
    const uploadInput = document.body.querySelector('[data-testid="media-picker-upload-input"]') as HTMLInputElement
    const file = new File(['x'], 'bad.bin', { type: 'application/octet-stream' })
    Object.defineProperty(uploadInput, 'files', { value: [file] })
    uploadInput.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('attach')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(document.body.querySelector('[data-testid="media-picker-error"]')?.textContent ?? '').toContain('Rejected file (HTTP 415)')
    wrapper.unmount()
  })

  it('drops a stale response when a newer fetch has advanced requestId', async () => {
    let resolveFirst!: (v: unknown) => void
    const firstPromise = new Promise<unknown>((res) => { resolveFirst = res })
    apiMock.get.mockReset()
    apiMock.get.mockReturnValueOnce(firstPromise)
    apiMock.get.mockResolvedValueOnce(makeListResponse({ assets: [makeAsset({ id: 'second' })], page: 1, lastPage: 1, total: 1 }))
    const wrapper = await mountAndSettle({}, makeListResponse({ assets: [], lastPage: 1, total: 0 }))
    // After mountAndSettle, the initial open fetch already returned
    // the empty list. We've consumed mockReturnValueOnce with the empty
    // list — so the call queue is reset and the next two `api.get`
    // calls will hit mockReturnValueOnce(firstPromise) then
    // mockResolvedValueOnce([second]).
    // Trigger a search so a new loadPage runs (advances requestId).
    const search = document.body.querySelector('[data-testid="media-picker-search"] input') as HTMLInputElement
    triggerChange(search, 'foo')
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()
    // Now resolve the older (still-pending) request — should be ignored.
    resolveFirst(makeListResponse({ assets: [makeAsset({ id: 'first' })], page: 1, lastPage: 1, total: 1 }))
    await flushPromises()
    await flushPromises()
    const cards = Array.from(document.body.querySelectorAll('[data-testid^="media-picker-card-"]'))
    expect(cards).toHaveLength(1)
    expect(cards[0].getAttribute('data-testid')).toBe('media-picker-card-second')
    wrapper.unmount()
  })

  it('resets selection state when the picker is reopened', async () => {
    const first = makeAsset({ id: 'a' })
    const wrapper = await mountAndSettle({}, makeListResponse({ assets: [first], lastPage: 1, total: 1 }))
    const cardA = document.body.querySelector('[data-testid="media-picker-card-a"]') as HTMLElement
    clickEl(cardA)
    await flushPromises()
    expect((document.body.querySelector('[data-testid="media-picker-card-a"]') as HTMLElement).getAttribute('data-selected')).toBe('true')
    // Close and reopen with a fresh list (asset id 'a' absent).
    apiMock.get.mockResolvedValueOnce(makeListResponse({ assets: [makeAsset({ id: 'z' })], lastPage: 1, total: 1 }))
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    await flushPromises()
    expect(document.body.querySelector('[data-testid="media-picker-card-a"]')).toBeFalsy()
    const cardZ = document.body.querySelector('[data-testid="media-picker-card-z"]') as HTMLElement
    expect(cardZ).toBeTruthy()
    expect(cardZ.getAttribute('data-selected')).toBe('false')
    expect(document.body.querySelector('[data-testid="media-picker-selected-count"]')?.textContent ?? '').toContain('0 selected')
    wrapper.unmount()
  })

  it('formats byte_size for the card overlay', async () => {
    const wrapper = await mountAndSettle({}, makeListResponse({
      assets: [
        makeAsset({ id: 'small', byte_size: 900 }),
        makeAsset({ id: 'medium', byte_size: 9000 }),
        makeAsset({ id: 'large', byte_size: 5_000_000 }),
      ],
      lastPage: 1,
      total: 3,
    }))
    expect(document.body.querySelector('[data-testid="media-picker-card-small"]')?.textContent ?? '').toContain('900 B')
    expect(document.body.querySelector('[data-testid="media-picker-card-medium"]')?.textContent ?? '').toContain('8.8 KB')
    expect(document.body.querySelector('[data-testid="media-picker-card-large"]')?.textContent ?? '').toContain('4.8 MB')
    wrapper.unmount()
  })

  it('defaults sourceFilter to all and sends ownership=mine (no scope, no source) on open', async () => {
    const wrapper = await mountAndSettle({ agentId: 7, mediaKind: 'image+document' })
    const url = apiMock.get.mock.calls[0][0] as string
    // `all` mode is the union (user uploads + tool rows of the user's
    // agents) — backend expresses that as `ownership=mine` and the
    // picker deliberately does NOT also send `scope=mine` so the
    // legacy upload-only WHERE branch stays dormant.
    expect(url).toContain('ownership=mine')
    expect(url).not.toContain('scope=')
    expect(url).not.toContain('source=')
    // The All pill is the one marked active.
    const allPill = document.body.querySelector('[data-testid="media-picker-source-all"]') as HTMLButtonElement
    expect(allPill).toBeTruthy()
    expect(allPill.getAttribute('aria-pressed')).toBe('true')
    const uploadPill = document.body.querySelector('[data-testid="media-picker-source-upload"]') as HTMLButtonElement
    expect(uploadPill.getAttribute('aria-pressed')).toBe('false')
    const toolPill = document.body.querySelector('[data-testid="media-picker-source-tool"]') as HTMLButtonElement
    expect(toolPill.getAttribute('aria-pressed')).toBe('false')
    wrapper.unmount()
  })

  it('clicking the Uploaded pill sends ?source=upload and refetches page 1', async () => {
    const wrapper = await mountAndSettle({}, makeListResponse({ assets: [], lastPage: 1, total: 0 }))
    apiMock.get.mockClear()
    apiMock.get.mockResolvedValueOnce(makeListResponse({ assets: [makeAsset({ id: 'u' })], lastPage: 1, total: 1 }))
    const uploadPill = document.body.querySelector('[data-testid="media-picker-source-upload"]') as HTMLButtonElement
    expect(uploadPill).toBeTruthy()
    clickEl(uploadPill)
    await flushPromises()
    expect(apiMock.get).toHaveBeenCalledTimes(1)
    const url = apiMock.get.mock.calls[0][0] as string
    // Uploaded mode uses the legacy scope=mine path because uploads
    // are exactly user_id-scoped — no agent join needed.
    expect(url).toContain('scope=mine')
    expect(url).toContain('source=upload')
    expect(url).not.toContain('ownership=')
    expect(url).toContain('page=1')
    expect((document.body.querySelector('[data-testid="media-picker-source-upload"]') as HTMLElement).getAttribute('aria-pressed')).toBe('true')
    expect((document.body.querySelector('[data-testid="media-picker-source-all"]') as HTMLElement).getAttribute('aria-pressed')).toBe('false')
    wrapper.unmount()
  })

  it('clicking the Generated pill sends ?ownership=mine&source=tool', async () => {
    const wrapper = await mountAndSettle({}, makeListResponse({ assets: [], lastPage: 1, total: 0 }))
    apiMock.get.mockClear()
    apiMock.get.mockResolvedValueOnce(makeListResponse({ assets: [makeAsset({ id: 'g' })], lastPage: 1, total: 1 }))
    const toolPill = document.body.querySelector('[data-testid="media-picker-source-tool"]') as HTMLButtonElement
    clickEl(toolPill)
    await flushPromises()
    expect(apiMock.get).toHaveBeenCalledTimes(1)
    const url = apiMock.get.mock.calls[0][0] as string
    // Tool mode narrows the union to upload_source='tool'.
    expect(url).toContain('ownership=mine')
    expect(url).toContain('source=tool')
    expect(url).not.toContain('scope=')
    expect(url).toContain('page=1')
    wrapper.unmount()
  })

  it('source filter persists across a debounced search', async () => {
    const wrapper = await mountAndSettle({}, makeListResponse({ assets: [], lastPage: 1, total: 0 }))
    apiMock.get.mockClear()
    const uploadPill = document.body.querySelector('[data-testid="media-picker-source-upload"]') as HTMLButtonElement
    clickEl(uploadPill)
    await flushPromises()
    apiMock.get.mockClear()
    apiMock.get.mockResolvedValueOnce(makeListResponse({ assets: [makeAsset({ id: 's' })], lastPage: 1, total: 1 }))
    const search = document.body.querySelector('[data-testid="media-picker-search"] input') as HTMLInputElement
    triggerChange(search, 'invoice')
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()
    const url = apiMock.get.mock.calls[0][0] as string
    expect(url).toContain('scope=mine')
    expect(url).toContain('source=upload')
    expect(url).not.toContain('ownership=')
    expect(url).toContain('q=invoice')
    expect(url).toContain('page=1')
    wrapper.unmount()
  })

  it('source filter persists across Load more', async () => {
    const first = makeListResponse({ assets: [makeAsset({ id: 'a' })], page: 1, lastPage: 2, total: 2 })
    const wrapper = await mountAndSettle({}, first)
    apiMock.get.mockClear()
    apiMock.get.mockResolvedValueOnce(makeListResponse({ assets: [makeAsset({ id: 'u' })], page: 1, lastPage: 2, total: 2 }))
    const uploadPill = document.body.querySelector('[data-testid="media-picker-source-upload"]') as HTMLButtonElement
    clickEl(uploadPill)
    await flushPromises()
    apiMock.get.mockClear()
    apiMock.get.mockResolvedValueOnce(makeListResponse({ assets: [makeAsset({ id: 'b' })], page: 2, lastPage: 2, total: 2 }))
    const moreBtn = document.body.querySelector('[data-testid="media-picker-load-more"]') as HTMLButtonElement
    expect(moreBtn).toBeTruthy()
    clickEl(moreBtn)
    await flushPromises()
    expect(apiMock.get).toHaveBeenCalledTimes(1)
    const secondUrl = apiMock.get.mock.calls[0][0] as string
    expect(secondUrl).toContain('scope=mine')
    expect(secondUrl).toContain('source=upload')
    expect(secondUrl).not.toContain('ownership=')
    expect(secondUrl).toContain('page=2')
    wrapper.unmount()
  })

  it('source filter resets to all on close-and-reopen', async () => {
    const wrapper = await mountAndSettle({}, makeListResponse({ assets: [], lastPage: 1, total: 0 }))
    const uploadPill = document.body.querySelector('[data-testid="media-picker-source-upload"]') as HTMLButtonElement
    clickEl(uploadPill)
    await flushPromises()
    expect((document.body.querySelector('[data-testid="media-picker-source-upload"]') as HTMLElement).getAttribute('aria-pressed')).toBe('true')
    // Close and reopen with a fresh fetch.
    apiMock.get.mockResolvedValueOnce(makeListResponse({ assets: [makeAsset({ id: 'z' })], lastPage: 1, total: 1 }))
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    await flushPromises()
    const allPill = document.body.querySelector('[data-testid="media-picker-source-all"]') as HTMLElement
    const uploadPillAfter = document.body.querySelector('[data-testid="media-picker-source-upload"]') as HTMLElement
    expect(allPill.getAttribute('aria-pressed')).toBe('true')
    expect(uploadPillAfter.getAttribute('aria-pressed')).toBe('false')
    // And the next fetch is the union (ownership=mine, no source
    // narrowing, no legacy scope=mine).
    const url = apiMock.get.mock.calls[apiMock.get.mock.calls.length - 1][0] as string
    expect(url).toContain('ownership=mine')
    expect(url).not.toContain('scope=')
    expect(url).not.toContain('source=')
    wrapper.unmount()
  })

  it('exposes the source filter as a fieldset with a sr-only legend', async () => {
    const wrapper = await mountAndSettle({}, makeListResponse({ assets: [], lastPage: 1, total: 0 }))
    const fieldset = document.body.querySelector('[data-testid="media-picker-source-filter"]') as HTMLElement
    expect(fieldset).toBeTruthy()
    // Must be a <fieldset> (not <div role="group">) — SonarQube Web:S6819
    // demands a semantic container so assistive tech that doesn't honour
    // ARIA roles still exposes the grouping.
    expect(fieldset.tagName.toLowerCase()).toBe('fieldset')
    const legend = fieldset.querySelector('legend')
    expect(legend).toBeTruthy()
    expect(legend?.textContent).toBe('Filter by source')
    // Legend must be visually hidden (sr-only) but stay in the a11y tree.
    expect(legend?.classList.contains('sr-only')).toBe(true)
    wrapper.unmount()
  })
})
