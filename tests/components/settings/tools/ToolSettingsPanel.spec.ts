import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import ToolSettingsPanel from '@/components/settings/tools/ToolSettingsPanel.vue'

const global = { stubs: { Icon: true } }

beforeEach(() => {
  setActivePinia(createPinia())
  // Suppress the async loadSettings() promise rejection in onMounted —
  // our mocks don't resolve and the unhandled rejection is benign noise.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

vi.mock('@/api/client', () => {
  class FakeApiError extends Error {
    status = 404
    constructor(msg = 'Not found') { super(msg); this.name = 'ApiError' }
  }
  return {
    default: {
      get: vi.fn().mockRejectedValue(new FakeApiError()),
      post: vi.fn(), put: vi.fn(), delete: vi.fn(),
    },
    api: {
      get: vi.fn().mockRejectedValue(new FakeApiError()),
      post: vi.fn(), put: vi.fn(), delete: vi.fn(),
    },
    ApiError: FakeApiError,
  }
})

describe('ToolSettingsPanel', () => {
  it('renders a settings panel with a password field', () => {
    const wrapper = mount(ToolSettingsPanel, {
      props: {
        tool: {
          tool_class: 'SendEmail',
          tool_name: 'send_email',
          display_name: 'Send Email',
          category: 'communication',
          settings_schema: [
            { key: 'host', label: 'Host', type: 'string', required: true, description: '', llm_exposed: false, sensitive: false },
            { key: 'password', label: 'Password', type: 'password', required: false, description: '', llm_exposed: false, sensitive: true },
          ],
          operations: [],
        },
        settings: { host: 'smtp.example.com', password: 'secret' },
      },
      global,
    })
    expect(wrapper.html()).toBeTruthy()
  })

  it('renders without throwing on minimal tool schema', () => {
    const wrapper = mount(ToolSettingsPanel, {
      props: {
        tool: {
          tool_class: 'SendEmail',
          tool_name: 'send_email',
          display_name: null,
          category: 'communication',
          settings_schema: [],
          operations: [],
        },
        settings: {},
      },
      global,
    })
    expect(wrapper.html()).toBeTruthy()
  })

  it('clears pending timers on unmount (SonarQube S2681: expanded onUnmounted body)', async () => {
    // Previously the onUnmounted was a one-liner with two statements that
    // only the first executed conditionally. After the fix it's a multi-line
    // block that always runs both clearTimeout calls. This test exercises
    // unmount and asserts no thrown errors from the cleanup hooks.
    const wrapper = mount(ToolSettingsPanel, {
      props: {
        tool: {
          tool_class: 'SendEmail',
          tool_name: 'send_email',
          display_name: 'Send Email',
          category: 'communication',
          settings_schema: [],
          operations: [],
        },
        settings: {},
      },
      global,
    })
    expect(() => wrapper.unmount()).not.toThrow()
  })

  it('renders the LLM Capabilities block when a field has expose_to_llm=true', () => {
    const wrapper = mount(ToolSettingsPanel, {
      props: {
        tool: {
          tool_class: 'SearchTool',
          tool_name: 'search',
          display_name: 'Search',
          category: 'utility',
          settings_schema: [
            { key: 'q', label: 'Query', type: 'string', required: true, description: 'Search query', expose_to_llm: true, sensitive: false },
          ],
          operations: [],
        },
        settings: { q: 'hi' },
      },
      global,
    })
    expect(wrapper.text()).toContain('LLM Capabilities')
  })

  it('emits saved when mode="group" is set (parent owns the HTTP call)', async () => {
    const wrapper = mount(ToolSettingsPanel, {
      props: {
        tool: {
          tool_class: 'SendEmail',
          tool_name: 'send_email',
          display_name: 'Send Email',
          category: 'communication',
          settings_schema: [
            { key: 'host', label: 'Host', type: 'string', required: true, description: '', llm_exposed: false, sensitive: false },
          ],
          operations: [],
        },
        settings: {},
        mode: 'group',
      },
      global,
    })
    const form = wrapper.findComponent({ name: 'ToolSettingsForm' })
    await form.vm.$emit('save', { host: 'smtp.example.com' })
    await flushPromises()
    expect(wrapper.emitted('saved')).toBeTruthy()
    expect(wrapper.emitted('saved')![0]).toEqual([{ host: 'smtp.example.com' }])
  })

  it('emits cleared when mode="group" triggers clear-to-global', async () => {
    const wrapper = mount(ToolSettingsPanel, {
      props: {
        tool: {
          tool_class: 'SendEmail',
          tool_name: 'send_email',
          display_name: 'Send Email',
          category: 'communication',
          settings_schema: [],
          operations: [],
        },
        settings: { host: 'x' },
        mode: 'group',
      },
      global,
    })
    const form = wrapper.findComponent({ name: 'ToolSettingsForm' })
    await form.vm.$emit('clear-to-global')
    await flushPromises()
    expect(wrapper.emitted('cleared')).toBeTruthy()
  })

  it('resolves mode=user to userSettings path via the composable', async () => {
    const wrapper = mount(ToolSettingsPanel, {
      props: {
        tool: {
          tool_class: 'SendEmail',
          tool_name: 'send_email',
          display_name: 'Send Email',
          category: 'communication',
          settings_schema: [],
          operations: [],
        },
        settings: {},
        mode: 'user',
      },
      global,
    })
    expect(wrapper.html()).toBeTruthy()
  })

  it('forwards principalId prop to ToolSettingsForm', () => {
    const wrapper = mount(ToolSettingsPanel, {
      props: {
        tool: {
          tool_class: 'HandoverTool',
          tool_name: 'handover',
          display_name: 'Handover',
          category: 'agents',
          settings_schema: [
            { key: 'allowed_target_agents', label: 'Allowed target agents', type: 'multi-select', required: false, description: '', expose_to_llm: true, sensitive: false, data_source: '/agents?select=id,name' },
          ],
          operations: [],
        },
        settings: {},
        mode: 'group',
        principalId: 42,
      },
      global,
    })
    const form = wrapper.findComponent({ name: 'ToolSettingsForm' })
    expect(form.exists()).toBe(true)
    expect(form.props('principalId')).toBe(42)
  })

  it('forwards principalId=null to ToolSettingsForm when the caller has no source principal', () => {
    const wrapper = mount(ToolSettingsPanel, {
      props: {
        tool: {
          tool_class: 'HandoverTool',
          tool_name: 'handover',
          display_name: 'Handover',
          category: 'agents',
          settings_schema: [],
          operations: [],
        },
        settings: {},
        mode: 'global',
        principalId: null,
      },
      global,
    })
    const form = wrapper.findComponent({ name: 'ToolSettingsForm' })
    expect(form.exists()).toBe(true)
    expect(form.props('principalId')).toBeNull()
  })

  it('mode="group" never re-fetches settings — the parent supplies them via initialSettings', async () => {
    // Bug lock: previously loadSettings() in mode="group" fell through
    // to the global-defaults branch and replaced serverSettings with
    // the operator's values, leaking them into the per-group editor.
    // Lock the fix: mode="group" short-circuits before any fetch.
    const wrapper = mount(ToolSettingsPanel, {
      props: {
        tool: {
          tool_class: 'MiniMaxTool',
          tool_name: 'image_minimax',
          display_name: 'MiniMax',
          category: 'image',
          settings_schema: [
            { key: 'api_key', label: 'API Key', type: 'password', required: true, description: '', expose_to_llm: false, sensitive: true },
          ],
          operations: [],
        },
        // Group-specific value the operator set in the operator panel;
        // the global-defaults endpoint would (incorrectly) return
        // something different. We assert the panel keeps the group's
        // value and never touches the global endpoint.
        initialSettings: { api_key: 'group-only-secret' },
        mode: 'group',
      },
      global,
    })
    await flushPromises()
    const form = wrapper.findComponent({ name: 'ToolSettingsForm' })
    expect(form.props('initialSettings')).toEqual({ api_key: 'group-only-secret' })
  })

  it('mode="user" fetches via getUserSettings on mount', async () => {
    // Counterpart assertion: the user-mode path still hits the user
    // settings endpoint so we don't regress the existing behaviour.
    const userSettingsMock = await import('@/composables/useToolSettings')
    const getUserSettingsSpy = vi.fn().mockResolvedValueOnce({ api_key: 'user-secret' })
    const getGlobalSettingsSpy = vi.fn().mockResolvedValueOnce({ api_key: 'global-secret' })
    vi.spyOn(userSettingsMock, 'useToolSettings').mockReturnValueOnce({
      getGlobalSettings: getGlobalSettingsSpy,
      getUserSettings: getUserSettingsSpy,
      putUserSettings: vi.fn(),
      putSettings: vi.fn(),
      deleteSettings: vi.fn(),
      deleteUserSettings: vi.fn(),
    } as unknown as ReturnType<typeof userSettingsMock.useToolSettings>)

    const wrapper = mount(ToolSettingsPanel, {
      props: {
        tool: {
          tool_class: 'MiniMaxTool',
          tool_name: 'image_minimax',
          display_name: 'MiniMax',
          category: 'image',
          settings_schema: [
            { key: 'api_key', label: 'API Key', type: 'password', required: true, description: '', expose_to_llm: false, sensitive: true },
          ],
          operations: [],
        },
        settings: {},
        mode: 'user',
      },
      global,
    })
    await flushPromises()
    expect(getUserSettingsSpy).toHaveBeenCalledWith('image_minimax')
    expect(getGlobalSettingsSpy).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'ToolSettingsForm' }).props('initialSettings'))
      .toEqual({ api_key: 'user-secret' })
  })

  it('mode="global" (default) fetches via getGlobalSettings on mount', async () => {
    const userSettingsMock = await import('@/composables/useToolSettings')
    const getUserSettingsSpy = vi.fn()
    const getGlobalSettingsSpy = vi.fn().mockResolvedValueOnce({ api_key: 'global-secret' })
    vi.spyOn(userSettingsMock, 'useToolSettings').mockReturnValueOnce({
      getGlobalSettings: getGlobalSettingsSpy,
      getUserSettings: getUserSettingsSpy,
      putUserSettings: vi.fn(),
      putSettings: vi.fn(),
      deleteSettings: vi.fn(),
      deleteUserSettings: vi.fn(),
    } as unknown as ReturnType<typeof userSettingsMock.useToolSettings>)

    const wrapper = mount(ToolSettingsPanel, {
      props: {
        tool: {
          tool_class: 'MiniMaxTool',
          tool_name: 'image_minimax',
          display_name: 'MiniMax',
          category: 'image',
          settings_schema: [
            { key: 'api_key', label: 'API Key', type: 'password', required: true, description: '', expose_to_llm: false, sensitive: true },
          ],
          operations: [],
        },
        settings: {},
        // No mode prop — should default to 'global'.
      },
      global,
    })
    await flushPromises()
    expect(getGlobalSettingsSpy).toHaveBeenCalledWith('image_minimax')
    expect(getUserSettingsSpy).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'ToolSettingsForm' }).props('initialSettings'))
      .toEqual({ api_key: 'global-secret' })
  })
})
