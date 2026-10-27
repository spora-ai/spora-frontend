/**
 * CommandMenu — the button that opens a list of commands.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import CommandMenu from '@/components/ui/CommandMenu.vue'

describe('CommandMenu', () => {
  it('does not open the menu until the trigger is clicked', async () => {
    const wrapper = mount(CommandMenu, {
      props: { actions: [{ id: 'a', label: 'Action A', onSelect: vi.fn() }] },
    })

    expect(wrapper.find('[data-testid="command-menu"]').exists()).toBe(false)

    await wrapper.find('[data-testid="command-menu-trigger"]').trigger('click')
    expect(wrapper.find('[data-testid="command-menu"]').exists()).toBe(true)
  })

  it('runs the selected action and closes the menu', async () => {
    const onSelect = vi.fn()
    const wrapper = mount(CommandMenu, {
      props: { actions: [{ id: 'a', label: 'Action A', onSelect }] },
    })

    await wrapper.find('[data-testid="command-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="command-menu-item-a"]').trigger('click')

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="command-menu"]').exists()).toBe(false)
  })

  it('does not run a disabled action', async () => {
    const onSelect = vi.fn()
    const wrapper = mount(CommandMenu, {
      props: { actions: [{ id: 'a', label: 'Action A', disabled: true, onSelect }] },
    })

    await wrapper.find('[data-testid="command-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="command-menu-item-a"]').trigger('click')

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('closes on a click outside the menu', async () => {
    const wrapper = mount(CommandMenu, {
      props: { actions: [{ id: 'a', label: 'Action A', onSelect: vi.fn() }] },
      attachTo: document.body,
    })

    await wrapper.find('[data-testid="command-menu-trigger"]').trigger('click')
    expect(wrapper.find('[data-testid="command-menu"]').exists()).toBe(true)

    document.body.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="command-menu"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('closes on Escape', async () => {
    const wrapper = mount(CommandMenu, {
      props: { actions: [{ id: 'a', label: 'Action A', onSelect: vi.fn() }] },
      attachTo: document.body,
    })

    await wrapper.find('[data-testid="command-menu-trigger"]').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="command-menu"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('opens upwards when asked to', async () => {
    const wrapper = mount(CommandMenu, {
      props: {
        actions: [{ id: 'a', label: 'Action A', onSelect: vi.fn() }],
        direction: 'up',
      },
    })

    await wrapper.find('[data-testid="command-menu-trigger"]').trigger('click')

    expect(wrapper.find('[data-testid="command-menu"]').classes()).toContain('bottom-full')
  })

  it('anchors the panel to the right edge when it opens upwards', async () => {
    // The trigger is the right-most control in its row, so a panel
    // anchored to the left edge would run off the viewport.
    const wrapper = mount(CommandMenu, {
      props: {
        actions: [{ id: 'a', label: 'Action A', onSelect: vi.fn() }],
        direction: 'up',
      },
    })

    await wrapper.find('[data-testid="command-menu-trigger"]').trigger('click')

    const classes = wrapper.find('[data-testid="command-menu"]').classes()
    expect(classes).toContain('right-0')
    expect(classes).not.toContain('left-0')
  })

  it('opens downwards by default', async () => {
    const wrapper = mount(CommandMenu, {
      props: { actions: [{ id: 'a', label: 'Action A', onSelect: vi.fn() }] },
    })

    await wrapper.find('[data-testid="command-menu-trigger"]').trigger('click')

    expect(wrapper.find('[data-testid="command-menu"]').classes()).toContain('top-full')
  })

  it('disables the trigger when asked to', () => {
    const wrapper = mount(CommandMenu, {
      props: {
        actions: [{ id: 'a', label: 'Action A', onSelect: vi.fn() }],
        disabled: true,
      },
    })

    expect(wrapper.find('[data-testid="command-menu-trigger"]').attributes('disabled')).toBeDefined()
  })

  it('names the trigger with the given label', () => {
    const wrapper = mount(CommandMenu, {
      props: {
        actions: [{ id: 'a', label: 'Action A', onSelect: vi.fn() }],
        ariaLabel: 'Chat commands',
      },
    })

    expect(wrapper.find('[data-testid="command-menu-trigger"]').attributes('aria-label')).toBe('Chat commands')
  })

  it('shows the action description under the label', async () => {
    const wrapper = mount(CommandMenu, {
      props: {
        actions: [{ id: 'a', label: 'Action A', description: 'Does a thing', onSelect: vi.fn() }],
      },
    })

    await wrapper.find('[data-testid="command-menu-trigger"]').trigger('click')

    expect(wrapper.find('[data-testid="command-menu-item-a"]').text()).toContain('Does a thing')
  })

  it('renders the bundled terminal glyph on the trigger by default', () => {
    const wrapper = mount(CommandMenu, {
      props: { actions: [{ id: 'a', label: 'Action A', onSelect: vi.fn() }] },
    })

    // The path data, not the element count: a name the installed package
    // does not bundle falls back to the puzzle glyph, and a count assertion
    // passes for either.
    const paths = wrapper
      .findAll('[data-testid="command-menu-trigger"] path')
      .map((path) => path.attributes('d'))
    expect(paths).toEqual(['M5 7l5 5-5 5', 'M12 17h7'])
  })
})
