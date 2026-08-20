/**
 * GroupSubNav — 6 link list with edit-only gating.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'

const routeMock = { params: { id: '7' } }
vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

import GroupSubNav from '@/components/groups/GroupSubNav.vue'

describe('GroupSubNav', () => {
  it('renders 6 nav items', () => {
    const wrapper = mount(GroupSubNav, {
      props: { canEdit: true },
      global: { stubs: { Icon: true, RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' } } },
    })
    expect(wrapper.findAll('a')).toHaveLength(6)
    expect(wrapper.text()).toContain('Overview')
    expect(wrapper.text()).toContain('Members')
    expect(wrapper.text()).toContain('Agents')
    expect(wrapper.text()).toContain('Tools')
    expect(wrapper.text()).toContain('LLM Drivers')
    expect(wrapper.text()).toContain('Settings')
  })

  it('hides the owner+admin hint when the caller can edit', () => {
    const wrapper = mount(GroupSubNav, {
      props: { canEdit: true },
      global: { stubs: { Icon: true } },
    })
    expect(wrapper.text()).not.toContain('owner + admin')
  })

  it('shows the owner+admin hint on edit-only items when the caller cannot edit', () => {
    const wrapper = mount(GroupSubNav, {
      props: { canEdit: false },
      global: { stubs: { Icon: true } },
    })
    expect(wrapper.text()).toContain('owner + admin')
  })
})
