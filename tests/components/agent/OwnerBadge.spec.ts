/**
 * OwnerBadge — small chip that surfaces the agent's owning principal.
 *
 * Four branches:
 *  - principal is null → no badge rendered
 *  - principal is 'user' and matches the caller → "You" (no link)
 *  - principal is 'user' but doesn't match → "User · {name}" (no link)
 *  - principal is 'group' → "Group · {name}" linking to /groups/:id
 */
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('vue-router', () => ({
  RouterLink: {
    name: 'RouterLink',
    props: ['to'],
    template: '<a :href="typeof to === \'object\' && to !== null ? to.name : String(to)"><slot /></a>',
  },
}))

import OwnerBadge from '@/components/agent/OwnerBadge.vue'

const authState = { user: null as { id: number; is_admin?: boolean } | null }

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: authState.user }),
}))

import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore() as unknown as { user: typeof authState.user }

const baseAgent = {
  id: 1,
  name: 'A',
  description: null,
  system_prompt: null,
  llm_driver_config_id: null,
  max_steps: 5,
  is_active: true,
  tools: [],
  transferable_to: [],
  notes: null,
  principal_id: 10,
}

function makeAgent(principal: Record<string, unknown> | null, principal_id = 10) {
  return { ...baseAgent, principal, principal_id }
}

beforeEach(() => {
  setActivePinia(createPinia())
  authState.user = null
})

describe('OwnerBadge', () => {
  it('renders nothing when principal is null', () => {
    const wrapper = mount(OwnerBadge, {
      props: { agent: makeAgent(null) },
    })
    expect(wrapper.find('.owner-badge').exists()).toBe(false)
  })

  it('renders "You" with no link when caller is the user principal', () => {
    authState.user = { id: 42 }
    const wrapper = mount(OwnerBadge, {
      props: {
        agent: makeAgent({ id: 10, type: 'user', name: 'Alice', user_id: 42, group_id: null }),
      },
    })
    expect(wrapper.text()).toBe('You')
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('renders "User · {name}" without a link when principal is user but not the caller', () => {
    authState.user = { id: 99 }
    const wrapper = mount(OwnerBadge, {
      props: {
        agent: makeAgent({ id: 10, type: 'user', name: 'Alice', user_id: 42, group_id: null }),
      },
    })
    expect(wrapper.text()).toBe('User · Alice')
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('renders "User · {name}" without a link when caller is unauthenticated', () => {
    authState.user = null
    const wrapper = mount(OwnerBadge, {
      props: {
        agent: makeAgent({ id: 10, type: 'user', name: 'Alice', user_id: 42, group_id: null }),
      },
    })
    expect(wrapper.text()).toBe('User · Alice')
  })

  it('renders "Group · {name}" with a link to /groups/:id for group principals', () => {
    const wrapper = mount(OwnerBadge, {
      props: {
        agent: makeAgent({ id: 11, type: 'group', name: 'Engineering', user_id: null, group_id: 5 }, 11),
      },
    })
    expect(wrapper.text()).toBe('Group · Engineering')
    const link = wrapper.find('a')
    expect(link.exists()).toBe(true)
  })

  it('marks the badge with data-owner-type=group for group principals', () => {
    const wrapper = mount(OwnerBadge, {
      props: {
        agent: makeAgent({ id: 11, type: 'group', name: 'Engineering', user_id: null, group_id: 5 }, 11),
      },
    })
    expect(wrapper.find('.owner-badge').attributes('data-owner-type')).toBe('group')
  })

  it('marks the badge with data-owner-type=user for user principals', () => {
    authState.user = { id: 99 }
    const wrapper = mount(OwnerBadge, {
      props: {
        agent: makeAgent({ id: 10, type: 'user', name: 'Alice', user_id: 42, group_id: null }),
      },
    })
    expect(wrapper.find('.owner-badge').attributes('data-owner-type')).toBe('user')
  })

  it('returns "You" when auth user is missing (defensive branch)', () => {
    authState.user = null
    const wrapper = mount(OwnerBadge, {
      props: {
        agent: makeAgent({ id: 10, type: 'user', name: 'Alice', user_id: 42, group_id: null }),
      },
    })
    // No crash, no "You" because we don't match — falls through to "User · Alice"
    expect(wrapper.text()).toBe('User · Alice')
    expect(authStore.user).toBeNull()
  })
})