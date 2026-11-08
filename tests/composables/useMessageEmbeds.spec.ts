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
  it('stays a link where there is no frame to mount', () => {
    // The tool bubble renders a plain string and has no frame to put in the
    // link's place, so the placeholder is put back as the link it was.
    const html = renderMarkdown(`[Dashboard](/api/v1/media/${ASSET_ID}/embed)`)
    expect(html).toContain(`<a href="/api/v1/media/${ASSET_ID}/embed">`)
    expect(html).not.toContain('data-media-embed')
  })

  it('becomes a placeholder in a message that can carry a frame', () => {
    const segments = renderMarkdownSegments(`[Dashboard](/api/v1/media/${ASSET_ID}/embed)`)
    expect(segments.map((s) => s.kind)).toEqual(['embed'])
    const embed = segments[0]
    expect(embed.kind === 'embed' && embed.assetId).toBe(ASSET_ID)
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

  it('keeps the paragraph of two references, rather than unwrapping it', () => {
    // Unwrapping is for a paragraph that holds nothing else. A paragraph
    // with two references keeps its tags — the split falls inside it and
    // the browser repairs that into two paragraphs — so the text between
    // the references is not left outside any paragraph.
    const segments = renderMarkdownSegments(
      `[A](/api/v1/media/${ASSET_ID}/embed) and [B](/api/v1/media/${ASSET_ID}/embed)`,
    )
    expect(segments.filter((s) => s.kind === 'embed')).toHaveLength(2)
    const first = segments[0]
    const last = segments[segments.length - 1]
    expect(first.kind === 'html' && first.html).toContain('<p>')
    expect(last.kind === 'html' && last.html).toContain('</p>')
  })

  it('names the asset by its canonical id, whatever case the model wrote', () => {
    // The server's uuid is lower case and it compares it as one, so a
    // reference written in upper case would name an asset it does not
    // have.
    const segments = renderMarkdownSegments(
      `[Dashboard](/api/v1/media/${ASSET_ID.toUpperCase()}/embed)`,
    )
    const embed = segments[0]
    expect(embed.kind === 'embed' && embed.assetId).toBe(ASSET_ID)
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

  it('re-renders when the message text changes', async () => {
    // The agent's answer lands after the turn it belongs to, so the text
    // of a message changes while the chat is open. A message that kept
    // the text it was created with would never show the answer.
    const wrapper = mount(MessageContent, { props: { content: 'FIRST ANSWER' } })
    await flushPromises()
    expect(wrapper.text()).toContain('FIRST ANSWER')

    await wrapper.setProps({ content: 'SECOND ANSWER' })
    await flushPromises()
    expect(wrapper.text()).toContain('SECOND ANSWER')
  })

  it('shows the reference as the model wrote it when it cannot be framed', async () => {
    batchResolveMock.mockImplementationOnce(async () => new Map())
    const wrapper = mount(MessageContent, {
      props: { content: `[**Dashboard**](/api/v1/media/${ASSET_ID}/embed)` },
    })
    await flushPromises()

    const link = wrapper.find('a')
    expect(link.text()).toBe('Dashboard')
    expect(link.html()).toContain('<strong>')
  })

  it('renders no frame for a descriptor that names another origin', async () => {
    // The server builds the URL, but the frame's `src` is a stronger
    // primitive than the `src` of an image, and the client does not take
    // a URL on trust.
    batchResolveMock.mockImplementationOnce(async (ids: readonly string[]) => {
      const map = new Map<string, { id: string; filename: string | null; asset_url: string; embed_descriptor: { url: string; mime: string; scripts: boolean } | null }>()
      for (const id of ids) {
        map.set(id, {
          id,
          filename: `${id}.html`,
          asset_url: `/api/v1/assets/${id}.html`,
          embed_descriptor: {
            url: 'https://elsewhere.example/embed',
            mime: 'text/html',
            scripts: true,
          },
        })
      }
      return map
    })
    const wrapper = mount(MessageContent, {
      props: { content: `[Dashboard](/api/v1/media/${ASSET_ID}/embed)` },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="media-embed-iframe"]').exists()).toBe(false)
    expect(wrapper.find('a').exists()).toBe(true)
  })
})
