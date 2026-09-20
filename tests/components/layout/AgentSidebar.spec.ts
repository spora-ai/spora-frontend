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

    // SonarQube Web:S6819: rows are native <button>s, not <li>s with
    // role="button". The <li> becomes a layout-only container.
    const agentButtons = wrapper.findAll('[aria-label^="Open agent "]')
    expect(agentButtons[1].classes()).toContain('bg-primary/10')
  })

  it('does not highlight inactive agents when agentId does not match', () => {
    mockAgentStore.agents = [makeAgent(1, 'Agent One'), makeAgent(2, 'Agent Two')]

    const wrapper = mount(AgentSidebar, {
      props: { agentId: 99 },
    })

    const agentButtons = wrapper.findAll('[aria-label^="Open agent "]')
    // No row button should have the active styling.
    for (const btn of agentButtons) {
      expect(btn.classes()).not.toContain('bg-primary/10')
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

    // Click handler now lives on the inner <button>; clicking the
    // <li> wrapper no longer fires the navigation handler.
    const agentButtons = wrapper.findAll('[aria-label^="Open agent "]')
    await agentButtons[0].trigger('click')
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
    expect(wrapper.text()).toContain('Eng')
  })

  it('pins the active group bucket at the top and demotes other groups to "Other agents"', () => {
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
    // Active agent's group (Beta) is pinned at the top.
    expect(wrapper.find('[data-testid="pinned-bucket-label"]').text()).toBe('Beta')
    // The non-active group (Alpha) lives inside the "Other agents" panel.
    const otherLabels = wrapper.findAll('[data-testid="other-bucket-label"]').map((el) => el.text())
    expect(otherLabels).toEqual(['Alpha'])
    expect(wrapper.find('[data-testid="other-agents-summary"]').text()).toBe('Other agents (1)')
  })

  it('renders "Unfiled" inside the "Other agents" panel for agents with no principal', () => {
    mockAgentStore.agents = [
      makeAgent(1, 'Legacy', { principal: null, principal_id: 0 }),
      makeAgent(2, 'Also Legacy', { principal: null, principal_id: 0 }),
    ]
    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1 },
      global: { stubs: { Icon: true, Avatar: true } },
    })
    // Unfiled is a fallback, not a focal section — it lives inside the
    // "Other agents" panel rather than being pinned at the top.
    expect(wrapper.find('[data-testid="pinned-bucket"]').exists()).toBe(false)
    const panel = wrapper.find('[data-testid="other-agents-panel"]')
    expect(panel.exists()).toBe(true)
    expect(panel.find('[data-testid="other-bucket-label"]').text()).toBe('Unfiled')
    expect(panel.find('[data-testid="other-agents-summary"]').text()).toBe('Other agents (2)')
  })

  it('uses agent.principal.name for the group bucket label, even when the principals store is empty', () => {
    // Sourcing the label from `agent.principal.name` means the sidebar
    // works on first paint — before the operator has visited a page
    // that warms the principals store (`/groups/:id/agents`,
    // `/agents/:id/settings`, the dashboard).
    mockAgentStore.agents = [
      makeAgent(1, 'A', { principal_id: 200, principal: { id: 200, type: 'group', name: 'Engineering', user_id: null, group_id: 9 } }),
    ]
    mockPrincipalsState.principals = []
    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1 },
      global: { stubs: { Icon: true, Avatar: true } },
    })
    expect(wrapper.text()).toContain('Engineering')
  })

  it('falls back to "#N" when the agent payload has no principal name', () => {
    // Legacy-fixture regression: an agent whose principal block carries
    // no `name` should still produce a usable bucket heading.
    mockAgentStore.agents = [
      makeAgent(1, 'A', { principal_id: 200, principal: { id: 200, type: 'group', user_id: null, group_id: 9 } as { id: number; type: 'group'; name?: string; user_id: null; group_id: number } }),
    ]
    mockPrincipalsState.principals = []
    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1 },
      global: { stubs: { Icon: true, Avatar: true } },
    })
    expect(wrapper.text()).toContain('#9')
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

  it('pins "My Agents" when the active agent belongs to the caller', () => {
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
    const pinned = wrapper.find('[data-testid="pinned-bucket"]')
    expect(pinned.exists()).toBe(true)
    expect(pinned.find('[data-testid="pinned-bucket-label"]').text()).toBe('My Agents')
    expect(pinned.text()).toContain('Mine')

    const panel = wrapper.find('[data-testid="other-agents-panel"]')
    expect(panel.exists()).toBe(true)
    expect(panel.find('[data-testid="other-agents-summary"]').text()).toBe('Other agents (1)')
  })

  it('does not render a pinned section when the active agentId matches no agent', () => {
    authState.user = { id: 7 }
    mockPrincipalsState.principals = [
      { id: 100, type: 'user', name: 'Me', user_id: 7, group_id: null },
    ]
    mockAgentStore.agents = [
      makeAgent(1, 'Mine', { principal_id: 100, principal: { id: 100, type: 'user', name: 'Me', user_id: 7, group_id: null } }),
      makeAgent(2, 'Group Bot', { principal_id: 200, principal: { id: 200, type: 'group', name: 'Eng', user_id: null, group_id: 5 } }),
    ]

    const wrapper = mount(AgentSidebar, {
      props: { agentId: 999 },
      global: { stubs: { Icon: true, Avatar: true } },
    })
    expect(wrapper.find('[data-testid="pinned-bucket"]').exists()).toBe(false)
    const panel = wrapper.find('[data-testid="other-agents-panel"]')
    expect(panel.exists()).toBe(true)
    expect(panel.find('[data-testid="other-agents-summary"]').text()).toBe('Other agents (2)')
    // "My Agents" itself becomes a label inside the panel when it isn't
    // the focus.
    expect(panel.text()).toContain('My Agents')
    expect(panel.text()).toContain('Eng')
  })

  it('swaps the pinned section when agentId prop changes between groups', async () => {
    mockAgentStore.agents = [
      makeAgent(1, 'Eng Bot', { principal_id: 200, principal: { id: 200, type: 'group', name: 'Eng', user_id: null, group_id: 7 } }),
      makeAgent(2, 'Sales Bot', { principal_id: 300, principal: { id: 300, type: 'group', name: 'Sales', user_id: null, group_id: 9 } }),
    ]
    mockPrincipalsState.principals = [
      { id: 200, type: 'group', name: 'Eng', user_id: null, group_id: 7 },
      { id: 300, type: 'group', name: 'Sales', user_id: null, group_id: 9 },
    ]

    const wrapper = mount(AgentSidebar, {
      props: { agentId: 1 },
      global: { stubs: { Icon: true, Avatar: true } },
    })

    let pinned = wrapper.find('[data-testid="pinned-bucket"]')
    expect(pinned.exists()).toBe(true)
    expect(pinned.find('[data-testid="pinned-bucket-label"]').text()).toBe('Eng')
    expect(pinned.text()).toContain('Eng Bot')
    expect(pinned.text()).not.toContain('Sales Bot')

    await wrapper.setProps({ agentId: 2 })

    pinned = wrapper.find('[data-testid="pinned-bucket"]')
    expect(pinned.exists()).toBe(true)
    expect(pinned.find('[data-testid="pinned-bucket-label"]').text()).toBe('Sales')
    expect(pinned.text()).toContain('Sales Bot')
    expect(pinned.text()).not.toContain('Eng Bot')
  })
})