/**
 * Avatar — initial-letter circle, archetype-avatar tile, and uploaded
 * image rendering.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import Avatar from '@/components/ui/Avatar.vue'
import type { AgentProfilePicture } from '@/types/agent'

describe('Avatar', () => {
  it('renders the supplied initials when no picture is provided', () => {
    const wrapper = mount(Avatar, { props: { initials: 'FB' } })
    expect(wrapper.text()).toBe('FB')
    expect(wrapper.find('[data-testid="avatar-initials"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="avatar-image"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="avatar-archetype"]').exists()).toBe(false)
  })

  it('uses muted tone by default', () => {
    const wrapper = mount(Avatar, { props: { initials: 'AB' } })
    expect(wrapper.classes()).toContain('bg-muted')
    expect(wrapper.classes()).toContain('text-foreground')
  })

  it('switches to primary tone when requested', () => {
    const wrapper = mount(Avatar, { props: { initials: 'AB', tone: 'primary' } })
    expect(wrapper.classes()).toContain('bg-foreground')
    expect(wrapper.classes()).toContain('text-background')
  })

  it('applies the requested size class', () => {
    const wrapper = mount(Avatar, { props: { initials: 'AB', size: 'lg' } })
    expect(wrapper.classes()).toContain('h-14')
    expect(wrapper.classes()).toContain('w-14')
  })

  it('renders an archetype avatar when profilePicture.kind=avatar', () => {
    const picture: AgentProfilePicture = {
      kind: 'avatar',
      archetype: 'researcher',
      variant_key: 'v1',
      palette_key: 'blue',
      fg_color: '#ffffff',
      bg_color: '#1D4ED8',
      image_url: null,
      image_updated_at: null,
    }
    const wrapper = mount(Avatar, {
      props: { initials: 'AB', profilePicture: picture },
    })
    expect(wrapper.find('[data-testid="avatar-archetype"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="avatar-initials"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="avatar-image"]').exists()).toBe(false)
    expect(wrapper.find('svg').exists()).toBe(true)
    const style = wrapper.find('[data-testid="avatar-archetype"]').attributes('style') ?? ''
    expect(style).toContain('#1D4ED8')
    expect(style).toContain('#ffffff')
  })

  it('renders an <img> when profilePicture.kind=image', () => {
    const picture: AgentProfilePicture = {
      kind: 'image',
      archetype: null,
      variant_key: null,
      palette_key: null,
      fg_color: null,
      bg_color: null,
      image_url: '/media/abc/picture.png',
      image_updated_at: '2026-01-02T03:04:05+00:00',
    }
    const wrapper = mount(Avatar, {
      props: { initials: 'AB', profilePicture: picture },
    })
    const img = wrapper.find('img')
    expect(img.exists()).toBe(true)
    // image_updated_at is appended as a ?v= query string so the browser
    // re-fetches when the operator re-uploads at the same MediaArchive URL.
    expect(img.attributes('src')).toBe('/media/abc/picture.png?v=2026-01-02T03%3A04%3A05%2B00%3A00')
    expect(img.attributes('data-image-updated-at')).toBe('2026-01-02T03:04:05+00:00')
    expect(wrapper.find('[data-testid="avatar-image"]').exists()).toBe(true)
  })

  it('renders the bare URL when image_updated_at is null (no cache-buster needed)', () => {
    // Defensive fallback: a malformed payload where image_updated_at is
    // null still has to render the URL as-is. The query-string branch
    // is skipped when there's no timestamp to append.
    const picture: AgentProfilePicture = {
      kind: 'image',
      archetype: null,
      variant_key: null,
      palette_key: null,
      fg_color: null,
      bg_color: null,
      image_url: '/media/abc/picture.png',
      image_updated_at: null,
    }
    const wrapper = mount(Avatar, {
      props: { initials: 'AB', profilePicture: picture },
    })
    expect(wrapper.find('img').attributes('src')).toBe('/media/abc/picture.png')
  })

  it('falls back to initials when profilePicture is null', () => {
    const wrapper = mount(Avatar, {
      props: { initials: 'AB', profilePicture: null },
    })
    expect(wrapper.text()).toBe('AB')
    expect(wrapper.find('[data-testid="avatar-initials"]').exists()).toBe(true)
  })

  it('falls back to initials when profilePicture.kind=avatar but archetype is missing', () => {
    const picture: AgentProfilePicture = {
      kind: 'avatar',
      archetype: null,
      variant_key: 'v0',
      palette_key: 'slate',
      fg_color: '#ffffff',
      bg_color: '#475569',
      image_url: null,
      image_updated_at: null,
    }
    const wrapper = mount(Avatar, {
      props: { initials: 'AB', profilePicture: picture },
    })
    expect(wrapper.find('[data-testid="avatar-initials"]').exists()).toBe(true)
  })
})
