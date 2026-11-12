import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import ToolArgumentsPreview from '@/components/agent/ToolArgumentsPreview.vue'

const global = { stubs: { Icon: true } }

/**
 * The preview's value formatter.
 *
 * The formatted field list renders only while the arguments are flat, and the
 * flatness check accepts nothing but a primitive — so an object value never
 * reaches the template and the formatter's own contract is the only thing
 * that can be asserted for it.
 */
function formatValue(wrapper: { vm: unknown }, value: unknown, format: string): string {
  return (wrapper.vm as unknown as {
    formatValue: (value: unknown, format: string) => string
  }).formatValue(value, format)
}

describe('ToolArgumentsPreview', () => {
  it('renders flat arguments as a field list', () => {
    const wrapper = mount(ToolArgumentsPreview, {
      props: { arguments: { to: 'a@b.co', body: 'hi' } },
      global,
    })
    expect(wrapper.text()).toContain('a@b.co')
    expect(wrapper.text()).toContain('hi')
  })

  it('renders a boolean argument as Yes or No', () => {
    const wrapper = mount(ToolArgumentsPreview, {
      props: { arguments: { enabled: true, archived: false } },
      global,
    })
    expect(wrapper.text()).toContain('Yes')
    expect(wrapper.text()).toContain('No')
  })

  it('renders complex arguments as syntax-highlighted JSON', () => {
    const wrapper = mount(ToolArgumentsPreview, {
      props: { arguments: { nested: { a: 1, b: [1, 2, 3] } } },
      global,
    })
    expect(wrapper.html()).toContain('<pre')
  })

  it('toggles sensitive value visibility', async () => {
    const wrapper = mount(ToolArgumentsPreview, {
      props: { arguments: { password: 'secret123' } },
      global,
    })
    expect(wrapper.text()).toContain('••••••••')
    const buttons = wrapper.findAll('button')
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('auto-expands when expanded prop is true', () => {
    const wrapper = mount(ToolArgumentsPreview, {
      props: { arguments: { to: 'a@b.co' }, expanded: true },
      global,
    })
    const details = wrapper.find('details')
    expect(details.attributes('open')).toBeDefined()
  })

  it('handles null arguments without throwing', () => {
    expect(() => mount(ToolArgumentsPreview, { props: { arguments: null }, global })).not.toThrow()
  })

  it('reveals a sensitive value masked, never in the clear', async () => {
    const wrapper = mount(ToolArgumentsPreview, {
      props: { arguments: { password: 'secret123' } },
      global,
    })
    expect(wrapper.text()).toContain('••••••••')

    const show = wrapper.findAll('button').find((b) => b.text() === 'show')
    expect(show).toBeDefined()
    await show!.trigger('click')

    // Only the ends of the value survive; the middle is dots.
    expect(wrapper.text()).toContain('se••••••••23')
    expect(wrapper.text()).not.toContain('secret123')
  })

  it('stringifies an object value as JSON instead of "[object Object]"', () => {
    const wrapper = mount(ToolArgumentsPreview, {
      props: { arguments: { retries: 3 } },
      global,
    })

    expect(formatValue(wrapper, { retries: 3 }, 'text')).toBe('{"retries":3}')
  })

  it('falls back to "[object Object]" for a value that cannot be serialised', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const wrapper = mount(ToolArgumentsPreview, {
      props: { arguments: { retries: 3 } },
      global,
    })

    expect(formatValue(wrapper, circular, 'text')).toBe('[object Object]')
  })

  it('falls back to the stringified value for a format it has no special case for', () => {
    const wrapper = mount(ToolArgumentsPreview, {
      props: { arguments: { retries: 3 } },
      global,
    })

    // The template's own fallback branch renders `String(field.value ?? '')`,
    // so the formatter's default arm has no template call site.
    expect(formatValue(wrapper, 'plain', 'text')).toBe('plain')
    expect(formatValue(wrapper, 42, 'text')).toBe('42')
  })
})
