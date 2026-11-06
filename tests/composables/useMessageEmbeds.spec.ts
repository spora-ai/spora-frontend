// @vitest-environment jsdom
/**
 * useMessageEmbeds — the live frames a message asks for.
 *
 * A model shows a widget by linking its embed route. The chat renders
 * that link as a frame, in place, so the operator sees the widget in the
 * conversation rather than in a tool call they have to go looking for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { renderMarkdown, renderMarkdownSegments } from '@/composables/useMarkdown'
import MessageContent from '@/components/agent/TaskChat/MessageContent.vue'

const ASSET_ID = 'af4c0838-9487-4e17-bc99-02d1c57ffed4'

const batchResolveMock = vi.fn(async (ids: readonly string[]) => {
  const map = new Map<string, { id: string; filename: string | null; asset_url: string; embed_descriptor: { url: string; mime: string; scripts: boolean } | null }>()
  for (const id of ids) {
    map.set(id, {
      id,
      filename: `${id}.png`,
      asset_url: `/api/v1/assets/${id}.png`,
      embed_descriptor: {
        url: `/api/v1/media/${id}/embed`,
        mime: 'text/html',
        scripts: true,
      },
    })
  }
  return map
})
vi.mock('@/composables/useMediaAssetCache', () => ({
  useMediaAssetCache: () => ({
    batchResolve: batchResolveMock,
    get: vi.fn(() => null),
  }),
  clearMediaAssetCache: vi.fn(),
}))

beforeEach(() => {
  batchResolveMock.mockClear()
})

describe('the embed route a model writes', () => {
  it('becomes a placeholder carrying the asset id', () => {
    const html = renderMarkdown(`[Dashboard](/api/v1/media/${ASSET_ID}/embed)`)
    expect(html).toContain(`data-media-embed="${ASSET_ID}"`)
    expect(html).toContain('Dashboard')
  })

  it('leaves every other link a link', () => {
    const html = renderMarkdown('[Docs](https://example.test/docs)')
    expect(html).toContain('<a href="https://example.test/docs"')
    expect(html).not.toContain('data-media-embed')
  })

  it('leaves a link to the asset route a link — the download path is not the embed path', () => {
    const html = renderMarkdown(`[Dashboard](/api/v1/assets/${ASSET_ID}.html)`)
    expect(html).not.toContain('data-media-embed')
  })
})

describe('renderMarkdownSegments', () => {
  it('splits a message at its reference', () => {
    const segments = renderMarkdownSegments(`Here it is:\n\n[Dashboard](/api/v1/media/${ASSET_ID}/embed)`)
    expect(segments.map((s) => s.kind)).toEqual(['html', 'embed'])
    const embed = segments[1]
    expect(embed.kind === 'embed' && embed.assetId).toBe(ASSET_ID)
  })

  it('unwraps the paragraph a lone reference sits in, so the frame is a block', () => {
    const segments = renderMarkdownSegments(`Here it is:\n\n[Dashboard](/api/v1/media/${ASSET_ID}/embed)`)
    const html = segments[0]
    expect(html.kind === 'html' && html.html).not.toContain('<p><span')
  })

  it('returns one html segment for a message with no reference', () => {
    const segments = renderMarkdownSegments('Just prose.')
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('html')
  })
})

describe('MessageContent', () => {
  it('renders the frame the message asks for', async () => {
    const wrapper = mount(MessageContent, {
      props: { content: `Here it is:\n\n[Dashboard](/api/v1/media/${ASSET_ID}/embed)` },
    })
    await flushPromises()

    const frame = wrapper.find('[data-testid="media-embed-iframe"]')
    expect(frame.exists()).toBe(true)
    expect(frame.attributes('src')).toBe(`/api/v1/media/${ASSET_ID}/embed`)
    expect(frame.attributes('sandbox')).toBe('allow-scripts')
  })

  it('keeps the frame inside the message, where the reference was', async () => {
    const wrapper = mount(MessageContent, {
      props: { content: `Here it is:\n\n[Dashboard](/api/v1/media/${ASSET_ID}/embed)` },
    })
    await flushPromises()

    // The prose comes first, the frame after it — the reference's place.
    expect(wrapper.text()).toContain('Here it is:')
    const html = wrapper.html()
    expect(html.indexOf('Here it is:')).toBeLessThan(html.indexOf('media-embed-iframe'))
  })

  it('renders no frame when the operator has not permitted the format', async () => {
    batchResolveMock.mockImplementationOnce(async () => new Map())
    const wrapper = mount(MessageContent, {
      props: { content: `[Dashboard](/api/v1/media/${ASSET_ID}/embed)` },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="media-embed-iframe"]').exists()).toBe(false)
    // The reference is still there as the text the model wrote.
    expect(wrapper.text()).toContain('Dashboard')
  })
})
