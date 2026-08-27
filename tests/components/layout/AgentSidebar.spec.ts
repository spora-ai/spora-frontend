import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AgentSidebar from '@/components/layout/AgentSidebar.vue'

const makeAgent = (id: number, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  description: null,
  system_prompt: null,
  principal_id: 1,
  principal: null,
  llm_provider: 'openai_compatible',
  llm_model: 'gpt-4o',
  llm_base_url: null,
  llm_driver_config_id: null,
  max_steps: 10,
  is_active: true,
  tools: [],
  ...overrides,
})

const mockAgentStore = {
  agents: [],
}

const mockPrincipalsState: { principals: Array<Record<string, unknown>> } = { principals: [] }

vi.mock('@/stores/agent', () => ({
  useAgentStore: () => mockAgentStore,
}))

vi.mock('@/stores/principals', () => ({
  usePrincipalsStore: () => mockPrincipalsState,
}))

const authState: { user: { id: number } | null } = { user: null }

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: authState.user }),
}))

const createDialogMock = { open: vi.fn() }

vi.mock('@/stores/createAgentDialog', () => ({
  useCreateAgentDialogStore: () => createDialogMock,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

describe('AgentSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAgentStore.agents = []
    mockPrincipalsState.principals = []
    authState.user = null
    createDialogMock.open.mockClear()
  })

  it('renders agents list from store', () => {
    mockAgentStore.agents = [makeAgent(1, 'Agent One'), makeAgent(2, 'Agent Two')]

    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1 },
    })

    expect(wrapper.text()).toContain('Agent One')
    expect(wrapper.text()).toContain('Agent Two')
  })

  it('highlights the active agent', () => {
    mockAgentStore.agents = [makeAgent(1, 'Agent One'), makeAgent(2, 'Agent Two')]

    const wrapper = mount(AgentSidebar, {
      props: { agentId: 2 },
    })

    const items = wrapper.findAll('li')
    expect(items[1].classes()).toContain('bg-primary/10')
  })

  it('does not highlight inactive agents when agentId does not match', () => {
    mockAgentStore.agents = [makeAgent(1, 'Agent One'), makeAgent(2, 'Agent Two')]

    const wrapper = mount(AgentSidebar, {
      props: { agentId: 99 },
    })

    const items = wrapper.findAll('li')
    // No item should have active classes
    for (const item of items) {
      expect(item.classes()).not.toContain('bg-primary/10')
    }
  })

  it('shows agent initial in avatar circle', () => {
    mockAgentStore.agents = [makeAgent(1, 'My Agent')]

    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1 },
    })

    const avatars = wrapper.findAll('.rounded-full')
    expect(avatars[0].text()).toBe('M')
  })

  it('emits close when an agent is clicked', async () => {
    mockAgentStore.agents = [makeAgent(1, 'Agent One')]

    const wrapper = mount(AgentSidebar, {
      props: { agentId: 2 },
    })

    await wrapper.findAll('li')[0].trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('renders extra slot content', () => {
    const wrapper = mount(AgentSidebar, {
      props: { agentId: 0 },
      slots: {
        extra: '<button data-testid="extra-btn">Extra</button>',
      },
    })

    expect(wrapper.find('[data-testid="extra-btn"]').exists()).toBe(true)
  })

  it('has hidden lg:flex class by default (desktop behavior)', () => {
    mockAgentStore.agents = [makeAgent(1, 'Agent')]

    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1 },
    })

    const aside = wrapper.find('aside')
    expect(aside.classes()).toContain('hidden')
    expect(aside.classes()).toContain('lg:flex')
  })

  it('removes hidden class when mobileOpen=true', () => {
    mockAgentStore.agents = [makeAgent(1, 'Agent')]

    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1, mobileOpen: true },
    })

    expect(wrapper.classes()).not.toContain('hidden')
  })

  it('emits close when the mobile backdrop is clicked', async () => {
    mockAgentStore.agents = [makeAgent(1, 'Agent')]

    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1, mobileOpen: true },
    })

    const backdrop = wrapper.find('.bg-black\\/50')
    expect(backdrop.exists()).toBe(true)
    await backdrop.trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('emits close when the mobile Close button is clicked', async () => {
    mockAgentStore.agents = [makeAgent(1, 'Agent')]

    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1, mobileOpen: true },
    })

    const closeBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Close')
    expect(closeBtn).toBeDefined()
    await closeBtn!.trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('renders the "My Agents" bucket when caller owns the principal', () => {
    authState.user = { id: 7 }
    mockPrincipalsState.principals = [
      { id: 100, type: 'user', name: 'Me', user_id: 7, group_id: null },
    ]
    mockAgentStore.agents = [
      makeAgent(1, 'Mine', { principal_id: 100, principal: { id: 100, type: 'user', name: 'Me', user_id: 7, group_id: null } }),
      makeAgent(2, 'Group Bot', { principal_id: 200, principal: { id: 200, type: 'group', name: 'Eng', user_id: null, group_id: 5 } }),
    ]
    mockPrincipalsState.principals.push({ id: 200, type: 'group', name: 'Eng', user_id: null, group_id: 5 })

    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1 },
      global: { stubs: { Icon: true, Avatar: true } },
    })
    expect(wrapper.text()).toContain('My Agents')
    expect(wrapper.text()).toContain('Group · Eng')
  })

  it('groups two group-owned agents under one bucket each, sorted by group_id', () => {
    mockAgentStore.agents = [
      makeAgent(1, 'B Bot', { principal_id: 200, principal: { id: 200, type: 'group', name: 'Beta', user_id: null, group_id: 9 } }),
      makeAgent(2, 'A Bot', { principal_id: 100, principal: { id: 100, type: 'group', name: 'Alpha', user_id: null, group_id: 7 } }),
    ]
    mockPrincipalsState.principals = [
      { id: 100, type: 'group', name: 'Alpha', user_id: null, group_id: 7 },
      { id: 200, type: 'group', name: 'Beta', user_id: null, group_id: 9 },
    ]

    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1 },
      global: { stubs: { Icon: true, Avatar: true } },
    })
    const groupLabels = wrapper.findAll('span.uppercase').map((s) => s.text())
    expect(groupLabels[0]).toBe('Group · Alpha')
    expect(groupLabels[1]).toBe('Group · Beta')
  })

  it('renders "Other" bucket for agents with no principal', () => {
    mockAgentStore.agents = [
      makeAgent(1, 'Legacy', { principal: null, principal_id: 0 }),
    ]
    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1 },
      global: { stubs: { Icon: true, Avatar: true } },
    })
    expect(wrapper.text()).toContain('Other')
  })

  it('falls back to "Group · #N" when no matching principal name exists', () => {
    mockAgentStore.agents = [
      makeAgent(1, 'A', { principal_id: 200, principal: { id: 200, type: 'group', name: 'unmapped', user_id: null, group_id: 9 } }),
    ]
    mockPrincipalsState.principals = []
    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1 },
      global: { stubs: { Icon: true, Avatar: true } },
    })
    expect(wrapper.text()).toContain('Group · #9')
  })

  it('renders an Open link per group bucket pointing to /groups/:id', () => {
    mockAgentStore.agents = [
      makeAgent(1, 'A', { principal_id: 200, principal: { id: 200, type: 'group', name: 'Eng', user_id: null, group_id: 7 } }),
    ]
    mockPrincipalsState.principals = [
      { id: 200, type: 'group', name: 'Eng', user_id: null, group_id: 7 },
    ]
    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1 },
      global: { stubs: { Icon: true, Avatar: true, RouterLink: { name: 'RouterLink', props: ['to'], template: '<a :href="JSON.stringify(to)"><slot /></a>' } } },
    })
    const openLink = wrapper.find('a')
    expect(openLink.text()).toBe('Open')
  })

  it('clicking the New Agent (+) button opens the create dialog', async () => {
    const wrapper = mount(AgentSidebar, {
      props: { agentId: 0 },
      global: { stubs: { Icon: true, Avatar: true } },
    })
    const newBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'New Agent')
    await newBtn!.trigger('click')
    expect(createDialogMock.open).toHaveBeenCalledWith('choice')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
