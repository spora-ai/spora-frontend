/**
 * NotificationSubscriptionsSection — per-user opt-in registry for
 * scheduled-run email notifications. The list is coarse: one row
 * for "My personal agents" (the caller's user-principal) plus one
 * row per group the caller is a member of.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const { subscribeMock, unsubscribeMock, listMock, groupsListMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  unsubscribeMock: vi.fn(),
  listMock: vi.fn(),
  groupsListMock: vi.fn(),
}))

vi.mock('@/api/notificationSubscriptions', () => ({
  notificationSubscriptionsApi: {
    list: listMock,
    subscribe: subscribeMock,
    unsubscribe: unsubscribeMock,
  },
}))

vi.mock('@/api/groups', () => ({
  groupsApi: {
    list: groupsListMock,
  },
}))

import NotificationSubscriptionsSection from '@/components/profile/NotificationSubscriptionsSection.vue'
import type { Group } from '@/api/groups'
import type { NotificationSubscription } from '@/api/notificationSubscriptions'

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 1,
    name: 'Shared Team',
    description: null,
    principal_id: 10,
    member_count: 3,
    my_role: 'member',
    ...overrides,
  }
}

function makeSubscription(overrides: Partial<NotificationSubscription> = {}): NotificationSubscription {
  return {
    id: 1,
    user_id: 5,
    target_type: 'principal',
    target_id: 10,
    created_at: '2026-08-31T10:00:00+00:00',
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  subscribeMock.mockReset()
  unsubscribeMock.mockReset()
  listMock.mockReset()
  groupsListMock.mockReset()
  subscribeMock.mockResolvedValue({ subscribed: true })
  unsubscribeMock.mockResolvedValue({ unsubscribed: true })
  groupsListMock.mockResolvedValue([])
  // Default: email dispatch is on, caller has a user-principal id of 5,
  // and there are no subscriptions yet.
  listMock.mockResolvedValue({ email_enabled: true, user_principal_id: 5, subscriptions: [] })
})

describe('NotificationSubscriptionsSection', () => {
  it('renders a "My personal agents" row by default when the caller has a user-principal', async () => {
    groupsListMock.mockResolvedValue([])

    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [] },
    })
    await flushPromises()

    const checkboxes = wrapper.findAll('input[type=checkbox]')
    expect(checkboxes).toHaveLength(1)
    expect(wrapper.text()).toContain('My personal agents')
  })

  it('hides the personal row when the caller has no user-principal yet', async () => {
    groupsListMock.mockResolvedValue([])
    listMock.mockResolvedValue({ email_enabled: true, user_principal_id: null, subscriptions: [] })

    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [] },
    })
    await flushPromises()

    expect(wrapper.findAll('input[type=checkbox]')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('My personal agents')
  })

  it('renders one row per group, pre-checked when already subscribed', async () => {
    groupsListMock.mockResolvedValue([
      makeGroup({ id: 1, name: 'Team A', principal_id: 10 }),
      makeGroup({ id: 2, name: 'Team B', principal_id: 20 }),
    ])
    listMock.mockResolvedValue({
      email_enabled: true,
      user_principal_id: 5,
      subscriptions: [makeSubscription({ id: 1, target_id: 10 })],
    })

    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [makeSubscription({ id: 1, target_id: 10 })] },
    })
    await flushPromises()

    // 1 personal + 2 groups = 3 checkboxes.
    const checkboxes = wrapper.findAll('input[type=checkbox]')
    expect(checkboxes).toHaveLength(3)
    expect((checkboxes[0].element as HTMLInputElement).checked).toBe(false) // personal
    expect((checkboxes[1].element as HTMLInputElement).checked).toBe(true)  // Team A
    expect((checkboxes[2].element as HTMLInputElement).checked).toBe(false) // Team B
    expect(wrapper.text()).toContain('Team A')
    expect(wrapper.text()).toContain('Team B')
  })

  it('subscribes the personal principal when the user toggles the personal row on', async () => {
    groupsListMock.mockResolvedValue([])

    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [] },
    })
    await flushPromises()

    const checkbox = wrapper.find('input[type=checkbox]')
    expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    await checkbox.setValue(true)
    await flushPromises()

    // The component's toggle() passes the full AvailableTarget; the
    // API client only reads target_type + target_id.
    expect(subscribeMock).toHaveBeenCalledTimes(1)
    const call = subscribeMock.mock.calls[0][0] as { target_type: string; target_id: number }
    expect(call.target_type).toBe('principal')
    expect(call.target_id).toBe(5)
    expect(unsubscribeMock).not.toHaveBeenCalled()
  })

  it('subscribes a group when its row is toggled on', async () => {
    groupsListMock.mockResolvedValue([makeGroup({ id: 1, name: 'Team A', principal_id: 10 })])
    listMock.mockResolvedValue({ email_enabled: true, user_principal_id: 5, subscriptions: [] })

    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [] },
    })
    await flushPromises()

    // Two checkboxes: personal (id=5) + group (id=10). The second is the group.
    const checkboxes = wrapper.findAll('input[type=checkbox]')
    expect(checkboxes).toHaveLength(2)
    await checkboxes[1].setValue(true)
    await flushPromises()

    const subscribeCall = subscribeMock.mock.calls[0][0] as { target_type: string; target_id: number }
    expect(subscribeCall.target_type).toBe('principal')
    expect(subscribeCall.target_id).toBe(10)
  })

  it('unsubscribes a previously-subscribed group when its row is toggled off', async () => {
    groupsListMock.mockResolvedValue([makeGroup({ id: 1, name: 'Team A', principal_id: 10 })])
    listMock.mockResolvedValue({
      email_enabled: true,
      user_principal_id: 5,
      subscriptions: [makeSubscription({ id: 1, target_id: 10 })],
    })

    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [makeSubscription({ id: 1, target_id: 10 })] },
    })
    await flushPromises()

    const checkboxes = wrapper.findAll('input[type=checkbox]')
    // The second checkbox is the group.
    await checkboxes[1].setValue(false)
    await flushPromises()

    const unsubCall = unsubscribeMock.mock.calls[0][0] as { target_type: string; target_id: number }
    expect(unsubCall.target_type).toBe('principal')
    expect(unsubCall.target_id).toBe(10)
    expect(subscribeMock).not.toHaveBeenCalled()
  })

  it('emits the canonical subscription list after subscribe()', async () => {
    groupsListMock.mockResolvedValue([])
    listMock.mockResolvedValueOnce({ email_enabled: true, user_principal_id: 5, subscriptions: [] })
      .mockResolvedValueOnce({ email_enabled: true, user_principal_id: 5, subscriptions: [makeSubscription({ id: 99, target_id: 5 })] })

    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [] },
    })
    await flushPromises()

    await wrapper.find('input[type=checkbox]').setValue(true)
    await flushPromises()

    const updates = wrapper.emitted('update:subscriptions')
    expect(updates).toBeDefined()
    const lastUpdate = updates![updates!.length - 1][0] as NotificationSubscription[]
    expect(lastUpdate).toHaveLength(1)
    expect(lastUpdate[0].id).toBe(99)
  })

  it('emits the updated subscription list after unsubscribe()', async () => {
    groupsListMock.mockResolvedValue([])
    listMock.mockResolvedValue({
      email_enabled: true,
      user_principal_id: 5,
      subscriptions: [makeSubscription({ id: 1, target_id: 5 })],
    })

    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [makeSubscription({ id: 1, target_id: 5 })] },
    })
    await flushPromises()

    await wrapper.find('input[type=checkbox]').setValue(false)
    await flushPromises()

    const updates = wrapper.emitted('update:subscriptions')
    expect(updates).toBeDefined()
    const lastUpdate = updates![updates!.length - 1][0] as NotificationSubscription[]
    expect(lastUpdate).toHaveLength(0)
  })

  it('renders the empty state when the caller has no user-principal and no groups', async () => {
    listMock.mockResolvedValue({ email_enabled: true, user_principal_id: null, subscriptions: [] })
    groupsListMock.mockResolvedValue([])

    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('No groups to manage yet.')
    expect(wrapper.findAll('input[type=checkbox]')).toHaveLength(0)
  })

  it('does not show the "disabled" banner when email_enabled is true (default)', async () => {
    listMock.mockResolvedValue({ email_enabled: true, user_principal_id: 5, subscriptions: [] })
    groupsListMock.mockResolvedValue([])

    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [] },
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('currently disabled on this server')
  })

  it('shows the "disabled" banner when email_enabled is false', async () => {
    listMock.mockResolvedValue({ email_enabled: false, user_principal_id: 5, subscriptions: [] })
    groupsListMock.mockResolvedValue([])

    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [] },
    })
    await flushPromises()

    const banner = wrapper.find('[role=alert]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('currently disabled on this server')
    expect(banner.text()).toContain('SPORA_NOTIFICATIONS_EMAIL_ENABLED=true')
  })

  it('surfaces an inline error when subscribe() fails', async () => {
    groupsListMock.mockResolvedValue([])
    const { ApiError } = await import('@/api/client')
    subscribeMock.mockRejectedValue(new ApiError('network down', 'NETWORK', 0))

    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [] },
    })
    await flushPromises()

    await wrapper.find('input[type=checkbox]').setValue(true)
    await flushPromises()

    expect(wrapper.text()).toContain('network down')
  })

  it('skips its own list() fetch when the parent passes subscriptionListReady=true', async () => {
    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [], subscriptionListReady: true },
    })
    await flushPromises()

    expect(listMock).not.toHaveBeenCalled()
  })

  it('refetches the list when subscriptionListReady flips from true to false', async () => {
    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [], subscriptionListReady: true },
    })
    await flushPromises()

    expect(listMock).not.toHaveBeenCalled()

    await wrapper.setProps({ subscriptionListReady: false })
    await flushPromises()

    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('updates the local refs when emailEnabled / userPrincipalId props change', async () => {
    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [], emailEnabled: true, userPrincipalId: 5 },
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('currently disabled on this server')

    await wrapper.setProps({ emailEnabled: false, userPrincipalId: 9 })
    await flushPromises()

    expect(wrapper.text()).toContain('currently disabled on this server')
  })

  it('surfaces an inline error when the initial list() call rejects', async () => {
    groupsListMock.mockResolvedValue([])
    const { ApiError } = await import('@/api/client')
    listMock.mockRejectedValueOnce(new ApiError('failed to load'))

    const wrapper = mount(NotificationSubscriptionsSection, {
      props: { subscriptions: [] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('failed to load')
  })
})
