/**
 * GlobalSheetGroups — groups list in the navbar sheet.
 *
 * Uses the real `useGroupsStore` (no full module mock) so reactivity
 * flows through Vue's normal channels. The router mock is local —
 * we don't need the full router machinery, just `useRouter().push`
 * and `useRoute().params`.
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
})
