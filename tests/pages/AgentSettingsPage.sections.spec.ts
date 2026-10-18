/**
 * AgentSettingsPage — section anchors, and the conditional API keys entry.
 *
 * The page is the only thing that knows both the nav order and the rendered
 * order, so it is the only place a pill-to-section mismatch could hide. The
 * sections themselves are stubbed: what is under test is the wiring, and a
 * stub keeps the test from breaking whenever a settings section changes its
 * internals.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'

const featureEnabled = ref(true)

vi.mock('@/composables/useFeatureEnabled', () => ({
  useFeatureEnabled: () => ({
    get value() {
      return featureEnabled.value
    },
  }),
}))

vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({
    currentAgent: { id: 7 },
    fetchAgents: vi.fn(),
    fetchAgent: vi.fn(),
  }),
}))

vi.mock('@/stores/llmConfigs', () => ({
  useLlmConfigsStore: () => ({ ensure: vi.fn() }),
}))

vi.mock('@/stores/llmPreferencesStore', () => ({
  useLlmPreferencesStore: () => ({ loadPreference: vi.fn() }),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '7' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

import AgentSettingsPage from '@/pages/AgentSettingsPage.vue'

/** Each stubbed section is identified by the `id` the page falls through. */
function sectionIds(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('[id]')
    .map((el) => el.attributes('id'))
    .filter((id): id is string => typeof id === 'string')
}

function render() {
  return mount(AgentSettingsPage, {
    global: {
      stubs: {
        AgentLayout: { template: '<div><slot /></div>' },
        SettingsSectionNav: {
          name: 'SettingsSectionNav',
          props: ['sections'],
          template: '<nav><a v-for="s in sections" :key="s.id" :href="\'#\' + s.id">{{ s.label }}</a></nav>',
        },
        AgentIdentitySection: true,
        AgentLlmSection: true,
        AgentToolsSpeechSection: true,
        AgentProfilePictureSection: true,
        AgentNotesSection: true,
        AgentOwnershipSection: true,
        AgentApiKeysSection: true,
        AgentDangerZone: true,
      },
    },
  })
}

describe('AgentSettingsPage sections', () => {
  beforeEach(() => {
    featureEnabled.value = true
    vi.clearAllMocks()
  })

  it('gives every nav entry a section that exists on the page', async () => {
    const wrapper = render()
    await flushPromises()

    const linked = wrapper
      .findAll('nav a')
      .map((a) => a.attributes('href')?.replace('#', ''))

    // The failure this catches is subtle: a pill renders fine whether or not
    // its target exists, and the nav would only look broken after a click.
    expect(linked.length).toBeGreaterThan(0)
    for (const id of linked) {
      expect(sectionIds(wrapper)).toContain(id)
    }
  })

  it('lists the API keys section when the feature is on', async () => {
    const wrapper = render()
    await flushPromises()

    expect(wrapper.text()).toContain('API keys')
    expect(sectionIds(wrapper)).toContain('api-keys')
  })

  it('drops the nav entry — but not the section — when the feature is off', async () => {
    featureEnabled.value = false

    const wrapper = render()
    await flushPromises()

    // No pill: the nav must not advertise something it will not show.
    expect(wrapper.findAll('nav a').map((a) => a.text())).not.toContain('API keys')

    // The section stays, because keys must remain revocable when the API is
    // not mounted. Hiding it would strand an operator who needs to clean up.
    expect(sectionIds(wrapper)).toContain('api-keys')
  })

  it('keeps the nav in the same order as the page', async () => {
    const wrapper = render()
    await flushPromises()

    const order = sectionIds(wrapper)
    const linked = wrapper.findAll('nav a').map((a) => a.attributes('href')?.replace('#', ''))

    expect(linked).toEqual(order.filter((id) => linked.includes(id)))
  })
})