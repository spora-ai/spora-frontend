/**
 * GroupOverviewPage — renders 4 stat cards with counts from the detail store.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reactive } from 'vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' } }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

interface DetailMock {
  group: Record<string, unknown> | null
  members: Array<unknown>
  agents: Array<unknown>
  toolSettings: Array<unknown>
  llmConfigs: Array<unknown>
  loading: boolean
  error: string | null
}

function freshDetail(): DetailMock {
  return {
    group: {
      id: 1,
      name: 'Eng',
      description: 'desc',
      principal_id: 10,
      member_count: 5,
      agent_count: 3,
      llm_config_count: 2,
      tool_setting_count: 4,
    },
    members: [],
    agents: [],
    toolSettings: [],
    llmConfigs: [],
    loading: false,
    error: null,
  }
}

const detailStoreMock = reactive<DetailMock>(freshDetail())

vi.mock('@/stores/groupDetail', () => ({
  useGroupDetailStore: () => detailStoreMock,
}))

import GroupOverviewPage from '@/pages/groups/GroupOverviewPage.vue'

describe('GroupOverviewPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(detailStoreMock, freshDetail())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders 4 stat cards with the counts from the detail store', () => {
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true } } })
    const text = wrapper.text()
    expect(text).toContain('Members')
    expect(text).toContain('5')
    expect(text).toContain('Agents')
    expect(text).toContain('3')
    expect(text).toContain('Tool settings')
    expect(text).toContain('4')
    expect(text).toContain('LLM drivers')
    expect(text).toContain('2')
  })

  it('falls back to list lengths when counts are missing', () => {
    Object.assign(detailStoreMock, freshDetail())
    detailStoreMock.group = { id: 1, name: 'Eng', description: null, principal_id: 10 }
    detailStoreMock.members = [{}, {}, {}]
    detailStoreMock.agents = [{}]
    detailStoreMock.toolSettings = [{}]
    detailStoreMock.llmConfigs = []
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true } } })
    expect(wrapper.text()).toContain('3')
    expect(wrapper.text()).toContain('1')
  })

  it('renders the Recent activity placeholder', () => {
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true } } })
    expect(wrapper.text()).toContain('Coming soon')
  })
})
