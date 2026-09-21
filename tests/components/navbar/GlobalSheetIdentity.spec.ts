/**
 * GlobalSheetIdentity — identity header at the top of the navbar sheet.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import GlobalSheetIdentity from '@/components/navbar/GlobalSheetIdentity.vue'
import type { User } from '@/types/user'

const user: User = {
  id: 1,
  email: 'alice@example.com',
  username: 'alice',
  name: 'Alice',
  is_admin: false,
  roles: [],
  verified: true,
}

describe('GlobalSheetIdentity', () => {
  it('renders the user name and email', () => {
    const wrapper = mount(GlobalSheetIdentity, { props: { user } })
    expect(wrapper.text()).toContain('Alice')
    expect(wrapper.text()).toContain('alice@example.com')
    wrapper.unmount()
  })

  it('falls back to email when name is null', () => {
    const wrapper = mount(GlobalSheetIdentity, {
      props: { user: { ...user, name: null } },
    })
    expect(wrapper.text()).toContain('alice@example.com')
    wrapper.unmount()
  })

  it('renders nothing user-facing when user is null', () => {
    const wrapper = mount(GlobalSheetIdentity, { props: { user: null } })
    expect(wrapper.text()).not.toContain('alice@example.com')
    wrapper.unmount()
  })

  it('emits close when the ✕ button is clicked', async () => {
    const wrapper = mount(GlobalSheetIdentity, { props: { user } })
    const closeBtn = wrapper.find('button[aria-label="Close menu"]')
    await closeBtn.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
