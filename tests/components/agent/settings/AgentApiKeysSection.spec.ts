/**
 * The 404 warning has to name the same path the heading names.
 *
 * The path lives in a constant, so a warning that spelled it out in its own
 * copy could drift from it — and a translator would have to carry a literal
 * path they cannot change. The warning interpolates the constant, so both
 * places read the same value.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'

import AgentApiKeysSection from '@/components/agent/settings/AgentApiKeysSection.vue'

describe('AgentApiKeysSection', () => {
  it('names the same path in the 404 warning as in the heading', () => {
    const wrapper = mount(AgentApiKeysSection, {
      props: { agentId: 7 },
      global: { stubs: { ApiKeyTable: true } },
    })

    const headingPath = wrapper.get('code').text()
    expect(headingPath).toBe('/api/v1/agent-api/*')

    // The runtime config has not been fetched, so the feature reads as off
    // and the warning is there to explain the 404.
    const warning = wrapper.get('[role="alert"]').text()
    expect(warning).toContain(headingPath)
  })
})
