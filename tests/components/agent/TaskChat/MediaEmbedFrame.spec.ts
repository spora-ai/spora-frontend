/**
 * MediaEmbedFrame — the live embed for a script-capable asset.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import MediaEmbedFrame from '@/components/agent/TaskChat/MediaEmbedFrame.vue'

describe('MediaEmbedFrame', () => {
  it('renders an iframe pointing at the embed route', () => {
    const wrapper = mount(MediaEmbedFrame, {
      props: { url: '/api/v1/media/abc/embed', mime: 'text/html', scripts: false },
    })

    const frame = wrapper.find('[data-testid="media-embed-iframe"]')
    expect(frame.exists()).toBe(true)
    expect(frame.attributes('src')).toBe('/api/v1/media/abc/embed')
  })

  it('sandboxes the frame without allowing scripts when the server withheld them', () => {
    const wrapper = mount(MediaEmbedFrame, {
      props: { url: '/api/v1/media/abc/embed', mime: 'text/html', scripts: false },
    })

    const frame = wrapper.find('[data-testid="media-embed-iframe"]')
    expect(frame.attributes('sandbox')).toBe('')
  })

  it('allows scripts only when the server said they may run', () => {
    const wrapper = mount(MediaEmbedFrame, {
      props: { url: '/api/v1/media/abc/embed', mime: 'text/html', scripts: true },
    })

    const frame = wrapper.find('[data-testid="media-embed-iframe"]')
    expect(frame.attributes('sandbox')).toBe('allow-scripts')
  })

  it('never allows same-origin, which would let the frame remove its own sandbox', () => {
    for (const scripts of [true, false]) {
      const wrapper = mount(MediaEmbedFrame, {
        props: { url: '/api/v1/media/abc/embed', mime: 'text/html', scripts },
      })

      expect(wrapper.find('[data-testid="media-embed-iframe"]').attributes('sandbox')).not.toContain(
        'allow-same-origin'
      )
    }
  })

  it('says so when the embedded content runs its own scripts', () => {
    const wrapper = mount(MediaEmbedFrame, {
      props: { url: '/api/v1/media/abc/embed', mime: 'text/html', scripts: true },
    })

    expect(wrapper.find('[data-testid="media-embed-script-note"]').exists()).toBe(true)
  })

  it('does not warn when the embedded content cannot run scripts', () => {
    const wrapper = mount(MediaEmbedFrame, {
      props: { url: '/api/v1/media/abc/embed', mime: 'text/html', scripts: false },
    })

    expect(wrapper.find('[data-testid="media-embed-script-note"]').exists()).toBe(false)
  })

  it('sends no referrer with the frame request', () => {
    const wrapper = mount(MediaEmbedFrame, {
      props: { url: '/api/v1/media/abc/embed', mime: 'text/html', scripts: false },
    })

    expect(wrapper.find('[data-testid="media-embed-iframe"]').attributes('referrerpolicy')).toBe(
      'no-referrer'
    )
  })
})
