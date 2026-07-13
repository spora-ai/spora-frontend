import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import TemplateWarningsModal from '@/components/agent/TemplateWarningsModal.vue'
import type { TemplateWarning } from '@/types/agentTemplate'

const baseWarning: TemplateWarning = {
  code: 'PLUGIN_MISSING',
  severity: 'warning',
  message: "Plugin 'weather' is required but not installed.",
}

describe('TemplateWarningsModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // The shared Modal uses <Teleport to="body">. Test Utils renders into
  // an off-document fragment by default, so we stub the Teleport to
  // keep the rendered output in-place. Mirrors PromptTemplateDialog.
  const global = { stubs: { Teleport: true, Icon: true } }

  it('renders the template name in the title and groups warnings by code', async () => {
    const wrapper = mount(TemplateWarningsModal, {
      props: {
        modelValue: true,
        templateName: 'Weather Helper',
        warnings: [
          baseWarning,
          {
            code: 'TOOL_NEEDS_CONFIGURATION',
            severity: 'warning',
            message: "Tool 'Spora\\Tools\\Foo' is missing required settings: api_key.",
          },
          {
            code: 'TOOL_PLUGIN_MISSING',
            severity: 'warning',
            message: "Tool 'X' is not currently registered.",
          },
          {
            code: 'OPERATION_UNKNOWN',
            severity: 'warning',
            message: "Operation 'save' is not declared.",
          },
        ],
      },
      global,
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Weather Helper')
    expect(wrapper.text()).toContain("Plugin 'weather'")
    expect(wrapper.text()).toContain('api_key')
    expect(wrapper.text()).toContain('not currently registered')
    expect(wrapper.text()).toContain('not declared')
  })

  it('emits confirm and updates v-model on user actions', async () => {
    const wrapper = mount(TemplateWarningsModal, {
      props: { modelValue: true, templateName: 'X', warnings: [baseWarning] },
      global,
    })
    // The "Import anyway" button is the primary action.
    const buttons = wrapper.findAll('button')
    const importAnyway = buttons.find((b) => b.text().includes('Import anyway'))
    expect(importAnyway).toBeTruthy()
    await importAnyway!.trigger('click')
    expect(wrapper.emitted('confirm')).toBeTruthy()

    // Cancel closes the modal.
    const cancel = buttons.find((b) => b.text() === 'Cancel')
    await cancel!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  })

  it('shows a clean "no warnings" state when the array is empty', async () => {
    const wrapper = mount(TemplateWarningsModal, {
      props: { modelValue: true, templateName: 'Clean', warnings: [] },
      global,
    })
    await flushPromises()
    expect(wrapper.text()).toContain('No warnings')
    expect(wrapper.text()).toContain('Import') // primary CTA, not "Import anyway"
  })
})