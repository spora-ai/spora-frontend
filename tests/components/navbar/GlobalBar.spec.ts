/**
 * GlobalBar — the unified top navigation bar.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import GlobalBar from '@/components/navbar/GlobalBar.vue'

function mountBar(props: Partial<{
  unreadCount: number
  isDark: boolean
  loggedIn: boolean
  menuOpen: boolean
}> = {}) {
  return mount(GlobalBar, {
    props: {
      unreadCount: 0,
      isDark: false,
      loggedIn: true,
      menuOpen: false,
      ...props,
    },
    global: { stubs: { RouterLink: true } },
  })
}

describe('GlobalBar', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders without throwing', () => {
    const wrapper = mountBar()
    expect(wrapper.exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the unread badge when unreadCount > 0', () => {
    const wrapper = mountBar({ unreadCount: 3 })
    expect(wrapper.text()).toContain('3')
    wrapper.unmount()
  })

  it('caps the badge at 99+', () => {
    const wrapper = mountBar({ unreadCount: 150 })
    expect(wrapper.text()).toContain('99+')
    wrapper.unmount()
  })

  it('does not show the badge when unreadCount is 0', () => {
    const wrapper = mountBar({ unreadCount: 0 })
    expect(wrapper.text()).not.toMatch(/99\+/)
    wrapper.unmount()
  })

  it('emits toggle-theme when the theme button is clicked', async () => {
    const wrapper = mountBar()
    await wrapper.findAll('button').find((b) => b.attributes('aria-label')?.includes('Switch to'))!.trigger('click')
    expect(wrapper.emitted('toggle-theme')).toHaveLength(1)
    wrapper.unmount()
  })

  it('emits open-notifications when the bell is clicked', async () => {
    const wrapper = mountBar()
    await wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Notifications')!.trigger('click')
    expect(wrapper.emitted('open-notifications')).toHaveLength(1)
    wrapper.unmount()
  })

  it('toggles menuOpen via the ≡ button', async () => {
    const wrapper = mountBar({ menuOpen: false })
    await wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Open menu')!.trigger('click')
    expect(wrapper.emitted('update:menuOpen')?.[0]).toEqual([true])
    wrapper.unmount()
  })

  it('reflects menuOpen in aria-expanded', async () => {
    const wrapper = mountBar({ menuOpen: true })
    const burger = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Open menu')!
    expect(burger.attributes('aria-expanded')).toBe('true')
    await wrapper.setProps({ menuOpen: false })
    expect(burger.attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('hides the search trigger when logged out', () => {
    const wrapper = mountBar({ loggedIn: false })
    const input = wrapper.find('button[aria-label="Search (⌘K)"]')
    expect(input.exists()).toBe(false)
    wrapper.unmount()
  })

  it('emits open-search when the desktop search trigger is clicked', async () => {
    const wrapper = mountBar({ loggedIn: true })
    const trigger = wrapper.find('button[aria-label="Search (⌘K)"]')
    expect(trigger.exists()).toBe(true)
    await trigger.trigger('click')
    expect(wrapper.emitted('open-search')).toHaveLength(1)
    wrapper.unmount()
  })

  it('renders the ⌘K badge inside the desktop search trigger', () => {
    const wrapper = mountBar({ loggedIn: true })
    const trigger = wrapper.find('button[aria-label="Search (⌘K)"]')
    expect(trigger.text()).toContain('Search…')
    expect(trigger.text()).toContain('⌘K')
    wrapper.unmount()
  })

  it('renders the status slot', async () => {
    const wrapper = mount(GlobalBar, {
      props: { unreadCount: 0, isDark: false, loggedIn: true, menuOpen: false },
      global: { stubs: { RouterLink: true } },
      slots: { status: '<span class="status-test">Status</span>' },
    })
    await nextTick()
    expect(wrapper.find('.status-test').exists()).toBe(true)
    wrapper.unmount()
  })
})
