/**
 * GroupSubNav — link list with role-based visibility. Edit-only items
 * (Tools / LLM Drivers / Settings) are hidden entirely for plain
 * members; the rail renders Overview + Members + Agents only.
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
  it('renders all 6 nav items when the caller can edit', () => {
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

  it('hides edit-only nav items entirely for plain group members (regression for hide-edit-only-tabs fix)', () => {
    const wrapper = mount(GroupSubNav, {
      props: { canEdit: false },
      global: { stubs: { Icon: true, RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' } } },
    })
    expect(wrapper.findAll('a')).toHaveLength(3)
    expect(wrapper.text()).toContain('Overview')
    expect(wrapper.text()).toContain('Members')
    expect(wrapper.text()).toContain('Agents')
    expect(wrapper.text()).not.toContain('Tools')
    expect(wrapper.text()).not.toContain('LLM Drivers')
    expect(wrapper.text()).not.toContain('Settings')
  })

  it('does not render the owner+admin badge once items are hidden', () => {
    const wrapper = mount(GroupSubNav, {
      props: { canEdit: false },
      global: { stubs: { Icon: true, RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' } } },
    })
    expect(wrapper.text()).not.toContain('owner + admin')
  })
})
