/**
 * AgentToolsToolbar — search input + status segmented filter + category
 * multi-select dropdown.
 *
 * Mounts standalone (not as a child of AgentToolsSection) so each v-model
 * contract is tested in isolation. `defineModel` exposes the props as
 * `search` / `status` / `selected` and re-emits `update:<name>` when
 * the inner ref is written — we assert that chain by passing the prop
 * and listening for the corresponding update event.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import AgentToolsToolbar from '@/components/agent/settings/AgentToolsToolbar.vue'

const sampleCategories = [
  { key: 'agent', label: 'Agent', count: 1 },
  { key: 'communication', label: 'Communication', count: 1 },
  { key: 'web', label: 'Web', count: 1 },
]
const sampleCounts = { all: 3, enabled: 1, needsSetup: 1, off: 1 }

async function openDropdown(wrapper: ReturnType<typeof mount>) {
  const summary = wrapper.find('[data-testid="category-filter"] summary')
  await summary.trigger('click')
}

describe('AgentToolsToolbar', () => {
  it('renders the search input with the expected placeholder', () => {
    const wrapper = mount(AgentToolsToolbar, {
      props: { categories: sampleCategories, statusCounts: sampleCounts, search: '' },
    })
    const input = wrapper.find('input[type="text"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('placeholder')).toContain('Search tools')
  })

  it('emits update:search when the input value changes', async () => {
    const wrapper = mount(AgentToolsToolbar, {
      props: { categories: sampleCategories, statusCounts: sampleCounts, search: '' },
    })
    await wrapper.find('input[type="text"]').setValue('time')
    expect(wrapper.emitted('update:search')?.[0]).toEqual(['time'])
  })

  it('renders the 4 status buttons with counts', () => {
    const wrapper = mount(AgentToolsToolbar, {
      props: { categories: sampleCategories, statusCounts: sampleCounts, status: 'all' },
    })
    expect(wrapper.find('[data-testid="status-filter-all"]').text()).toContain('3')
    expect(wrapper.find('[data-testid="status-filter-enabled"]').text()).toContain('1')
    expect(wrapper.find('[data-testid="status-filter-needs-setup"]').text()).toContain('1')
    expect(wrapper.find('[data-testid="status-filter-off"]').text()).toContain('1')
  })

  it('marks the active status button as aria-selected', () => {
    const wrapper = mount(AgentToolsToolbar, {
      props: { categories: sampleCategories, statusCounts: sampleCounts, status: 'all' },
    })
    expect(wrapper.find('[data-testid="status-filter-all"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[data-testid="status-filter-enabled"]').attributes('aria-selected')).toBe('false')
  })

  it('emits update:status when a different status button is clicked', async () => {
    const wrapper = mount(AgentToolsToolbar, {
      props: { categories: sampleCategories, statusCounts: sampleCounts, status: 'all' },
    })
    await wrapper.find('[data-testid="status-filter-enabled"]').trigger('click')
    expect(wrapper.emitted('update:status')?.[0]).toEqual(['enabled'])
  })

  it('opens the category dropdown on summary click', async () => {
    const wrapper = mount(AgentToolsToolbar, {
      props: {
        categories: sampleCategories,
        statusCounts: sampleCounts,
        selected: new Set<string>(),
      },
    })
    await openDropdown(wrapper)
    const labels = wrapper.findAll('[data-testid="category-filter"] label')
    expect(labels).toHaveLength(3)
  })

  it('emits update:selected with a Set when a category is toggled on', async () => {
    const wrapper = mount(AgentToolsToolbar, {
      props: {
        categories: sampleCategories,
        statusCounts: sampleCounts,
        selected: new Set<string>(),
      },
    })
    await openDropdown(wrapper)
    await wrapper.findAll('[data-testid="category-filter"] label input')[0].setValue(true)
    const emitted = wrapper.emitted('update:selected')
    expect(emitted).toBeDefined()
    const lastSet = emitted![emitted!.length - 1][0] as Set<string>
    expect(lastSet.has('agent')).toBe(true)
  })

  it('emits update:selected with an empty Set when "Clear selection" is clicked', async () => {
    const wrapper = mount(AgentToolsToolbar, {
      props: {
        categories: sampleCategories,
        statusCounts: sampleCounts,
        selected: new Set<string>(['agent', 'web']),
      },
    })
    await openDropdown(wrapper)
    await wrapper.find('[data-testid="category-filter"] button').trigger('click')
    const emitted = wrapper.emitted('update:selected')
    expect(emitted).toBeDefined()
    const lastSet = emitted![emitted!.length - 1][0] as Set<string>
    expect(lastSet.size).toBe(0)
  })

  it('shows "All categories" in the summary when nothing is selected', () => {
    const wrapper = mount(AgentToolsToolbar, {
      props: {
        categories: sampleCategories,
        statusCounts: sampleCounts,
        selected: new Set<string>(),
      },
    })
    expect(wrapper.find('[data-testid="category-filter"] summary').text()).toContain('All categories')
  })

  it('shows the selected label in the summary when one category is selected', () => {
    const wrapper = mount(AgentToolsToolbar, {
      props: {
        categories: sampleCategories,
        statusCounts: sampleCounts,
        selected: new Set<string>(['agent']),
      },
    })
    expect(wrapper.find('[data-testid="category-filter"] summary').text()).toContain('Agent')
  })

  it('shows "N categories" in the summary when multiple are selected', () => {
    const wrapper = mount(AgentToolsToolbar, {
      props: {
        categories: sampleCategories,
        statusCounts: sampleCounts,
        selected: new Set<string>(['agent', 'web']),
      },
    })
    expect(wrapper.find('[data-testid="category-filter"] summary').text()).toContain('2 categories')
  })
})
