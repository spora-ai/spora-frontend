/**
 * AgentSettingsPage — thin shell that fetches the agent and wires the four
 * settings sub-components. Stubs the sub-components and the layout so this
 * suite only covers the page's own wiring. Tool configuration lives on
 * AgentToolsPage and is covered by its own suite.
 *
 * Each test mounts its own wrapper. The page's `watch(currentAgent, ...)`
 * subscribes to the module-level `currentAgentRef`, so without explicit
 * unmount the previous test's component would still receive updates and
 * consume the next test's mock queue (pushMock/toastSuccessMock).
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const route = { params: { id: '42' } }
const pushMock = vi.fn().mockResolvedValue(undefined)
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push: pushMock }),
}))

const fetchAgentsMock = vi.fn().mockResolvedValue(undefined)
const fetchAgentMock = vi.fn().mockResolvedValue(undefined)
const currentAgentRef = ref<{ id: number; name: string } | null>(null)
vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({
    get currentAgent() { return currentAgentRef.value },
    fetchAgents: fetchAgentsMock,
    fetchAgent: fetchAgentMock,
  }),
}))

const ensureMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/stores/llmConfigs', () => ({
  useLlmConfigsStore: () => ({ ensure: ensureMock }),
}))

const loadPreferenceMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/stores/llmPreferencesStore', () => ({
  useLlmPreferencesStore: () => ({ loadPreference: loadPreferenceMock }),
}))

const toastSuccessMock = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    info: vi.fn(),
    error: vi.fn(),
    success: toastSuccessMock,
    warning: vi.fn(),
  }),
}))

const AgentLayoutStub = {
  name: 'AgentLayout',
  props: ['agentId'],
  template: '<div class="agent-layout-stub"><slot /></div>',
}

const IdentityStub = {
  name: 'AgentIdentitySection',
  props: ['agent', 'agentId'],
  template: '<div class="identity-stub" :data-agent-id="agentId" />',
}
const LlmStub = {
  name: 'AgentLlmSection',
  props: ['agent', 'agentId'],
  template: '<div class="llm-stub" :data-agent-id="agentId" />',
}
const PictureStub = {
  name: 'AgentProfilePictureSection',
  props: ['agent', 'agentId'],
  template: '<div class="picture-stub" :data-agent-id="agentId" />',
}
const NotesStub = {
  name: 'AgentNotesSection',
  props: ['agent', 'agentId'],
  template: '<div class="notes-stub" :data-agent-id="agentId" />',
}
const DangerStub = {
  name: 'AgentDangerZone',
  props: ['agent', 'agentId'],
  template: '<div class="danger-stub" :data-agent-id="agentId" />',
}
const OwnershipStub = {
  name: 'AgentOwnershipSection',
  props: ['agent'],
  template: '<div class="ownership-stub" />',
}

import AgentSettingsPage from '@/pages/AgentSettingsPage.vue'

let mountedWrappers: ReturnType<typeof mount>[] = []

beforeEach(() => {
  setActivePinia(createPinia())
  currentAgentRef.value = null
  fetchAgentsMock.mockClear()
  fetchAgentMock.mockClear()
  ensureMock.mockClear()
  loadPreferenceMock.mockClear()
  pushMock.mockReset()
  toastSuccessMock.mockReset()
  mountedWrappers = []
})

afterEach(() => {
  for (const w of mountedWrappers) w.unmount()
})

function mountPage() {
  const wrapper = mount(AgentSettingsPage, {
    global: {
      stubs: {
        AgentLayout: AgentLayoutStub,
        AgentIdentitySection: IdentityStub,
        AgentLlmSection: LlmStub,
        AgentProfilePictureSection: PictureStub,
        AgentNotesSection: NotesStub,
        AgentOwnershipSection: OwnershipStub,
        AgentDangerZone: DangerStub,
      },
    },
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

describe('AgentSettingsPage', () => {
  it('shows the loading state until the agent is fetched', async () => {
    const wrapper = mountPage()
    expect(wrapper.text()).toContain('Loading')
    await flushPromises()
  })

  it('fetches agent, configs, and preferences in parallel on mount', async () => {
    mountPage()
    await flushPromises()
    expect(fetchAgentsMock).toHaveBeenCalledTimes(1)
    expect(fetchAgentMock).toHaveBeenCalledWith(42)
    expect(ensureMock).toHaveBeenCalledTimes(1)
    expect(loadPreferenceMock).toHaveBeenCalledTimes(1)
  })

  it('parses the route id as a number and passes it down to the sub-sections', async () => {
    currentAgentRef.value = { id: 42, name: 'Loaded' }
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.identity-stub').attributes('data-agent-id')).toBe('42')
    expect(wrapper.find('.llm-stub').attributes('data-agent-id')).toBe('42')
    expect(wrapper.find('.picture-stub').attributes('data-agent-id')).toBe('42')
    expect(wrapper.find('.notes-stub').attributes('data-agent-id')).toBe('42')
    expect(wrapper.find('.danger-stub').attributes('data-agent-id')).toBe('42')
  })

  it('renders every section once the agent is loaded', async () => {
    currentAgentRef.value = { id: 42, name: 'Loaded' }
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.identity-stub').exists()).toBe(true)
    expect(wrapper.find('.llm-stub').exists()).toBe(true)
    expect(wrapper.find('.picture-stub').exists()).toBe(true)
    expect(wrapper.find('.notes-stub').exists()).toBe(true)
    expect(wrapper.find('.ownership-stub').exists()).toBe(true)
    expect(wrapper.find('.danger-stub').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Loading')
  })

  it('does not navigate away when currentAgent starts null on mount', async () => {
    mountPage()
    await flushPromises()
    await nextTick()
    expect(pushMock).not.toHaveBeenCalled()
    expect(toastSuccessMock).not.toHaveBeenCalled()
  })

  it('navigates to the dashboard with a success toast when the current agent is cleared', async () => {
    currentAgentRef.value = { id: 42, name: 'Loaded' }
    const wrapper = mountPage()
    await flushPromises()

    currentAgentRef.value = null
    await nextTick()
    await flushPromises()

    expect(toastSuccessMock).toHaveBeenCalledWith('Agent deleted')
    expect(pushMock).toHaveBeenCalledWith({ name: 'dashboard' })
    // Watch must fire on the page, not via a child emit — the wrapper has to
    // survive the <main v-else> unmount or the redirect is lost.
    expect(wrapper.exists()).toBe(true)
  })

  it('survives the child DangerZone unmounting while redirecting', async () => {
    // Regression: clearing currentAgent unmounts DangerZone in the same
    // microtask window as the store mutation. The watch fires on the page
    // instance, not through a child emit, so the redirect must still happen.
    currentAgentRef.value = { id: 42, name: 'Loaded' }
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.danger-stub').exists()).toBe(true)

    currentAgentRef.value = null
    await nextTick()
    await flushPromises()

    expect(wrapper.find('.danger-stub').exists()).toBe(false)
    expect(pushMock).toHaveBeenCalledWith({ name: 'dashboard' })
  })
})
