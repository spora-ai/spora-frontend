/**
 * GlobalSheetGroups — groups list in the navbar sheet.
 *
 * Uses the real `useGroupsStore` (no full module mock) so reactivity
 * flows through Vue's normal channels. The router mock is local —
 * we don't need the full router machinery, just `useRouter().push`
 * and `useRoute().params`. `localStorage` is the real jsdom one
 * (cleared in `beforeEach`) so the `useRecentGroups` composable can
 * round-trip MRU ids through it.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useGroupsStore } from '@/stores/groups'

const pushMock = vi.fn()
const routeParamsRef = ref<Record<string, string | string[]>>({})

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  useRoute: () => ({ get params() { return routeParamsRef.value } }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>', props: ['to'] },
}))

import GlobalSheetGroups from '@/components/navbar/GlobalSheetGroups.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  routeParamsRef.value = {}
  pushMock.mockReset()
  localStorage.clear()
})

function seedGroups(items: { id: number; name: string; member_count?: number }[]): void {
  const store = useGroupsStore()
  store.groups = items.map((g) => ({
    id: g.id,
    name: g.name,
    description: null,
    principal_id: g.id,
    member_count: g.member_count,
  }))
}

function visibleGroupNames(wrapper: ReturnType<typeof mount>): string[] {
  // The button text contains the avatar initials, the name, and the
  // member-count line — pull just the <p> that holds the name.
  return wrapper.findAll('ul li button').map((b) => b.find('p').text())
}

describe('GlobalSheetGroups', () => {
  it('shows "No groups yet" when the cache is empty', () => {
    const wrapper = mount(GlobalSheetGroups)
    expect(wrapper.text()).toContain('No groups yet')
    wrapper.unmount()
  })

  it('renders group tiles from the store cache', async () => {
    seedGroups([
      { id: 1, name: 'Engineering', member_count: 4 },
      { id: 2, name: 'Marketing', member_count: 2 },
    ])
    const wrapper = mount(GlobalSheetGroups)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Engineering')
    expect(wrapper.text()).toContain('Marketing')
    wrapper.unmount()
  })

  it('marks the active group when route.params.id matches', async () => {
    seedGroups([
      { id: 1, name: 'Engineering', member_count: 4 },
      { id: 2, name: 'Marketing', member_count: 2 },
    ])
    routeParamsRef.value = { id: '1' }
    const wrapper = mount(GlobalSheetGroups)
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    const engineeringBtn = buttons.find((b) => b.text().includes('Engineering'))!
    expect(engineeringBtn.classes()).toContain('bg-muted')
    wrapper.unmount()
  })

  it('navigates to a group when its tile is clicked', async () => {
    seedGroups([{ id: 1, name: 'Engineering', member_count: 4 }])
    const wrapper = mount(GlobalSheetGroups)
    await wrapper.vm.$nextTick()
    const btn = wrapper.findAll('button').find((b) => b.text().includes('Engineering'))!
    await btn.trigger('click')
    expect(pushMock).toHaveBeenCalledWith({ name: 'group-overview', params: { id: '1' } })
    wrapper.unmount()
  })

  it('records the visited group in recents', async () => {
    seedGroups([{ id: 1, name: 'Engineering', member_count: 4 }])
    const wrapper = mount(GlobalSheetGroups)
    await wrapper.vm.$nextTick()
    const btn = wrapper.findAll('button').find((b) => b.text().includes('Engineering'))!
    await btn.trigger('click')
    expect(localStorage.getItem('spora.groups.recent.v1')).toBe('[1]')
    wrapper.unmount()
  })

  it('auto-records the active group from the route on mount', async () => {
    seedGroups([{ id: 7, name: 'DesignOps', member_count: 3 }])
    routeParamsRef.value = { id: '7' }
    mount(GlobalSheetGroups)
    await Promise.resolve()
    expect(localStorage.getItem('spora.groups.recent.v1')).toBe('[7]')
  })

  it('navigates to /groups when "See all" is clicked', async () => {
    const wrapper = mount(GlobalSheetGroups)
    const seeAll = wrapper.findAll('button').find((b) => b.text().trim() === 'See all')!
    await seeAll.trigger('click')
    expect(pushMock).toHaveBeenCalledWith({ name: 'groups' })
    wrapper.unmount()
  })

  it('singularises "member" when member_count is 1', async () => {
    seedGroups([{ id: 1, name: 'Solo', member_count: 1 }])
    const wrapper = mount(GlobalSheetGroups)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('1 member')
    expect(wrapper.text()).not.toContain('1 members')
    wrapper.unmount()
  })

  it('renders initial letters when the group has no profile picture', async () => {
    seedGroups([{ id: 1, name: 'Engineering', member_count: 2 }])
    const wrapper = mount(GlobalSheetGroups)
    await wrapper.vm.$nextTick()
    const avatar = wrapper.find('[data-testid="avatar-initials"]')
    expect(avatar.exists()).toBe(true)
    expect(avatar.text()).toBe('EN')
    wrapper.unmount()
  })

  it('renders the uploaded profile picture when the group has one', async () => {
    const store = useGroupsStore()
    store.groups = [{
      id: 1,
      name: 'Engineering',
      description: null,
      principal_id: 1,
      member_count: 2,
      profile_picture: {
        kind: 'image',
        image_url: '/media/group-1.png',
        image_updated_at: '2026-01-01T00:00:00Z',
      },
    }]
    const wrapper = mount(GlobalSheetGroups)
    await wrapper.vm.$nextTick()
    const img = wrapper.find('[data-testid="avatar-image"] img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('/media/group-1.png?v=2026-01-01T00%3A00%3A00Z')
    wrapper.unmount()
  })

  it('floats recent groups to the top of the list', async () => {
    seedGroups([
      { id: 1, name: 'Alpha', member_count: 1 },
      { id: 2, name: 'Bravo', member_count: 1 },
      { id: 3, name: 'Charlie', member_count: 1 },
      { id: 4, name: 'Delta', member_count: 1 },
    ])
    localStorage.setItem('spora.groups.recent.v1', JSON.stringify([3, 1]))
    const wrapper = mount(GlobalSheetGroups)
    await wrapper.vm.$nextTick()
    expect(visibleGroupNames(wrapper)).toEqual(['Charlie', 'Alpha', 'Bravo', 'Delta'])
    wrapper.unmount()
  })

  it('drops recent ids whose group no longer exists', async () => {
    seedGroups([
      { id: 1, name: 'Alpha', member_count: 1 },
      { id: 2, name: 'Bravo', member_count: 1 },
    ])
    // 99 was deleted server-side; recents can outlive membership.
    localStorage.setItem('spora.groups.recent.v1', JSON.stringify([99, 2]))
    const wrapper = mount(GlobalSheetGroups)
    await wrapper.vm.$nextTick()
    expect(visibleGroupNames(wrapper)).toEqual(['Bravo', 'Alpha'])
    wrapper.unmount()
  })

  it('hides the Show more button when there are 5 or fewer groups', async () => {
    seedGroups(
      Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `G${i + 1}`, member_count: 1 })),
    )
    const wrapper = mount(GlobalSheetGroups)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="groups-show-more"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows a Show more button that reveals all groups when toggled', async () => {
    seedGroups(
      Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: `G${i + 1}`, member_count: 1 })),
    )
    const wrapper = mount(GlobalSheetGroups)
    await wrapper.vm.$nextTick()
    expect(visibleGroupNames(wrapper)).toHaveLength(5)
    const toggle = wrapper.find('[data-testid="groups-show-more"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.text()).toContain('Show more')
    expect(toggle.text()).toContain('(7)')
    expect(toggle.attributes('aria-expanded')).toBe('false')

    await toggle.trigger('click')
    expect(visibleGroupNames(wrapper)).toHaveLength(7)
    expect(toggle.text()).toContain('Show less')
    expect(toggle.attributes('aria-expanded')).toBe('true')

    await toggle.trigger('click')
    expect(visibleGroupNames(wrapper)).toHaveLength(5)
    wrapper.unmount()
  })
})
