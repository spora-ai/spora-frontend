/**
 * PluginCard — single plugin summary tile.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import PluginCard from '@/apps/plugins/components/PluginCard.vue'
import MigrationStatusBadge from '@/apps/plugins/components/MigrationStatusBadge.vue'
import type { PluginResource } from '@/apps/plugins/types/plugin'

const basePlugin: PluginResource = {
  slug: 'minimax',
  name: 'MiniMax',
  description: 'Image, speech, music, lyrics, and video generation.',
  icon: 'puzzle',
  version: 1,
  path: '/plugins/minimax',
  bundledTools: [{ name: 'image', description: 'Generate an image' }],
  bundledDrivers: [{ provider: 'minimax', class: 'Spora\\Plugins\\MiniMax\\Driver' }],
  recipePaths: [],
  migrations: {
    declared: 1,
    applied: 1,
    filesOnDisk: 1,
    pending: 0,
    lastAppliedAt: '2026-06-09 10:15:32',
    status: 'up_to_date',
  },
}

/**
 * Tools-only plugin — no drivers, no recipes. Matches every plugin shipped
 * today; used to assert the driver/recipe chips correctly hide when the
 * corresponding bundle is empty.
 */
const toolsOnlyPlugin: PluginResource = {
  ...basePlugin,
  slug: 'tavily',
  name: 'Tavily',
  bundledDrivers: [],
  recipePaths: [],
}

describe('PluginCard', () => {
  it('renders the plugin name and description', () => {
    const wrapper = mount(PluginCard, { props: { plugin: basePlugin } })
    expect(wrapper.text()).toContain('MiniMax')
    expect(wrapper.text()).toContain('Image, speech, music')
  })

  it('shows the schema version when > 0', () => {
    const wrapper = mount(CardWithBadge, { props: { plugin: basePlugin } })
    expect(wrapper.text()).toContain('v1')
  })

  it('hides the version label when version is 0', () => {
    const wrapper = mount(CardWithBadge, { props: { plugin: { ...basePlugin, version: 0 } } })
    expect(wrapper.text()).not.toContain('v0')
  })

  it('shows bundled tool / driver / recipe counts when each is non-empty', () => {
    const wrapper = mount(CardWithBadge, { props: { plugin: basePlugin } })
    const counts = wrapper.findAll('span[title]')
    expect(counts.length).toBeGreaterThanOrEqual(3)
  })

  it('hides the driver and recipe count chips when the plugin brings neither', () => {
    const wrapper = mount(CardWithBadge, { props: { plugin: toolsOnlyPlugin } })
    // Only the tools chip should render. Assert via the title attribute so
    // we don't tie the assertion to a specific icon import or class.
    const titles = wrapper.findAll('span[title]').map(s => s.attributes('title'))
    expect(titles.some(t => t?.includes('bundled tool'))).toBe(true)
    expect(titles.some(t => t?.includes('bundled driver'))).toBe(false)
    expect(titles.some(t => t?.includes('recipe path'))).toBe(false)
  })

  it('falls back to the slug when no description is set', () => {
    const wrapper = mount(CardWithBadge, { props: { plugin: { ...basePlugin, description: '' } } })
    expect(wrapper.text()).toContain('Plugin slug: minimax')
  })

  it('emits select with the plugin when clicked', async () => {
    const wrapper = mount(PluginCard, { props: { plugin: basePlugin } })
    const cardButton = wrapper.find(`button[data-testid="plugin-card-${basePlugin.slug}"]`)
    expect(cardButton.exists()).toBe(true)
    await cardButton.trigger('click')
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')![0]).toEqual([basePlugin])
  })

  it('emits action update and does not bubble to select when the Update button is clicked', async () => {
    const wrapper = mount(PluginCard, { props: { plugin: basePlugin, showActions: true } })
    await wrapper.find(`button[data-testid="update-${basePlugin.slug}"]`).trigger('click')
    expect(wrapper.emitted('action')).toBeTruthy()
    expect(wrapper.emitted('action')![0]).toEqual([{ type: 'update', plugin: basePlugin }])
    expect(wrapper.emitted('select')).toBeFalsy()
  })

  it('emits action uninstall and does not bubble to select when the Uninstall button is clicked', async () => {
    const wrapper = mount(PluginCard, { props: { plugin: basePlugin, showActions: true } })
    await wrapper.find(`button[data-testid="uninstall-${basePlugin.slug}"]`).trigger('click')
    expect(wrapper.emitted('action')).toBeTruthy()
    expect(wrapper.emitted('action')![0]).toEqual([{ type: 'uninstall', plugin: basePlugin }])
    expect(wrapper.emitted('select')).toBeFalsy()
  })
})

// Reusable mount with the badge stubbed — keeps DOM assertions small and stable.
import { h } from 'vue'
const CardWithBadge = {
  components: { PluginCard, MigrationStatusBadge },
  props: { plugin: { type: Object, required: true } },
  setup(props) {
    return () => h(PluginCard, { plugin: props.plugin })
  },
}
