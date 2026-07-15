/**
 * KebabMenu — trigger + dropdown panel with outside-click and Escape close.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import KebabMenu from '@/components/ui/KebabMenu.vue'

describe('KebabMenu', () => {
  const actions = [
    { id: 'open', label: 'Open', onClick: vi.fn() },
    { id: 'settings', label: 'Settings', onClick: vi.fn() },
    { id: 'delete', label: 'Delete', danger: true, onClick: vi.fn() },
  ]

  beforeEach(() => {
    actions.forEach((a) => a.onClick.mockClear())
  })

  it('renders only the trigger by default', () => {
    const wrapper = mount(KebabMenu, { props: { actions } })
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="More actions"]').exists()).toBe(true)
  })

  it('opens the menu when the trigger is clicked', async () => {
    const wrapper = mount(KebabMenu, { props: { actions } })
    await wrapper.get('button[aria-label="More actions"]').trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Open')
    expect(wrapper.text()).toContain('Delete')
  })

  it('invokes onClick and closes when an action is selected', async () => {
    const wrapper = mount(KebabMenu, { props: { actions }, attachTo: document.body })
    await wrapper.get('button[aria-label="More actions"]').trigger('click')
    const items = wrapper.findAll('[role="menuitem"]')
    await items[1].trigger('click')
    expect(actions[1].onClick).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('closes when Escape is pressed', async () => {
    const wrapper = mount(KebabMenu, { props: { actions } })
    await wrapper.get('button[aria-label="More actions"]').trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)
    // The component listens for Escape on document, so dispatch a real
    // KeyboardEvent there rather than triggering on the wrapper.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })
})