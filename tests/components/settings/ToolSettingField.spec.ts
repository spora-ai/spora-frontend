import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import ToolSettingField from '@/components/settings/ToolSettingField.vue'
import type { ToolSettingSchema } from '@/composables/useToolSettings'

vi.mock('@/api/client', () => ({
  api: { get: vi.fn() },
}))

import { api } from '@/api/client'
const mockApi = api as ReturnType<typeof vi.fn>

const global = { stubs: { Icon: true } }

function makeField(overrides: Partial<ToolSettingSchema> = {}): ToolSettingSchema {
  return {
    key: 'api_key',
    label: 'API Key',
    type: 'text',
    description: 'Your API key',
    default: null,
    required: false,
    options: null,
    expose_to_llm: false,
    ...overrides,
  }
}

describe('ToolSettingField', () => {
  describe('label rendering', () => {
    it('renders the field label by default', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: '', field: makeField() },
        global,
      })

      expect(wrapper.text()).toContain('API Key')
    })

    it('hides the label when hideLabel is true', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: '', field: makeField(), hideLabel: true },
        global,
      })

      expect(wrapper.text()).not.toContain('API Key')
    })

    it('marks the label as required when the field is required', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: '', field: makeField({ required: true }) },
        global,
      })

      expect(wrapper.text()).toContain('*')
    })
  })

  describe('text input', () => {
    it('renders a text input by default', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: 'hello', field: makeField() },
        global,
      })

      const input = wrapper.find('input[type="text"]')
      expect(input.exists()).toBe(true)
      expect((input.element as HTMLInputElement).value).toBe('hello')
    })

    it('emits update:modelValue when the input changes', async () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: '', field: makeField() },
        global,
      })

      const input = wrapper.find('input[type="text"]')
      await input.setValue('new value')

      const events = wrapper.emitted('update:modelValue')
      expect(events).toBeTruthy()
      expect(events![0][0]).toBe('new value')
    })
  })

  describe('textarea', () => {
    it('renders a textarea for type=textarea', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: 'multi\nline', field: makeField({ type: 'textarea' }) },
        global,
      })

      const textarea = wrapper.find('textarea')
      expect(textarea.exists()).toBe(true)
    })
  })

  describe('select', () => {
    it('renders a select for type=select with object options', () => {
      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: 'metric',
          field: makeField({ type: 'select', options: { metric: 'Metric', imperial: 'Imperial' } }),
        },
        global,
      })

      const select = wrapper.find('select')
      expect(select.exists()).toBe(true)
      const options = wrapper.findAll('option')
      expect(options.length).toBeGreaterThan(0)
    })

    it('renders the resolveOptionLabel output for object options', () => {
      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: 'small',
          field: makeField({
            type: 'select',
            key: 'size',
            label: 'Size',
            options: { small: 'Small', large: 'Large' },
          }),
        },
        global,
      })
      const select = wrapper.find('select')
      expect(select.exists()).toBe(true)
      expect(select.findAll('option').map(o => o.text())).toEqual(
        expect.arrayContaining(['Small', 'Large']),
      )
    })

    it('renders array options for type=select', () => {
      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: 'csv',
          field: makeField({
            type: 'select',
            key: 'format',
            label: 'Format',
            options: ['csv', 'json'],
          }),
        },
        global,
      })
      const select = wrapper.find('select')
      expect(select.exists()).toBe(true)
      expect(select.findAll('option').map(o => o.text())).toEqual(
        expect.arrayContaining(['csv', 'json']),
      )
    })
  })

  describe('toggle', () => {
    it('renders a Toggle for type=toggle', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: true, field: makeField({ type: 'toggle' }) },
        global,
      })

      const toggles = wrapper.findAllComponents({ name: 'Toggle' })
      expect(toggles.length).toBe(1)
    })

    it('renders OFF for boolean false', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: false, field: makeField({ type: 'toggle' }) },
        global,
      })
      expect(wrapper.find('button[role="switch"]').attributes('aria-checked')).toBe('false')
    })

    it('renders OFF for the string "false" (form round-trip value)', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: 'false', field: makeField({ type: 'toggle' }) },
        global,
      })
      expect(wrapper.find('button[role="switch"]').attributes('aria-checked')).toBe('false')
    })

    it('renders ON for the string "true" (form round-trip value)', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: 'true', field: makeField({ type: 'toggle' }) },
        global,
      })
      expect(wrapper.find('button[role="switch"]').attributes('aria-checked')).toBe('true')
    })

    it('emits true when clicked with string "false"', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: 'false', field: makeField({ type: 'toggle' }) },
        global,
      })
      void wrapper.find('button[role="switch"]').trigger('click')
      expect(wrapper.emitted('update:modelValue')![0][0]).toBe(true)
    })

    it('emits false when clicked with string "true"', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: 'true', field: makeField({ type: 'toggle' }) },
        global,
      })
      void wrapper.find('button[role="switch"]').trigger('click')
      expect(wrapper.emitted('update:modelValue')![0][0]).toBe(false)
    })

    it('emits false when clicked with boolean true', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: true, field: makeField({ type: 'toggle' }) },
        global,
      })
      void wrapper.find('button[role="switch"]').trigger('click')
      expect(wrapper.emitted('update:modelValue')![0][0]).toBe(false)
    })

    it('does not emit when disabled', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: 'false', field: makeField({ type: 'toggle' }), disabled: true },
        global,
      })
      void wrapper.find('button[role="switch"]').trigger('click')
      expect(wrapper.emitted('update:modelValue')).toBeFalsy()
    })
  })

  describe('password', () => {
    it('shows the locked display when value is the masked sentinel', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: '***', field: makeField({ type: 'password' }) },
        global,
      })

      // The locked display uses bullet characters
      expect(wrapper.text()).toContain('•')
      expect(wrapper.text()).toContain('Change')
    })

    it('emits empty string when Change is clicked', async () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: '***', field: makeField({ type: 'password' }) },
        global,
      })

      const changeBtn = wrapper.findAll('button').find(b => b.text() === 'Change')!
      await changeBtn.trigger('click')

      const events = wrapper.emitted('update:modelValue')
      expect(events).toBeTruthy()
      expect(events![0][0]).toBe('')
    })

    it('shows a password input when the user clicks Change', async () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: '***', field: makeField({ type: 'password' }) },
        global,
      })

      const changeBtn = wrapper.findAll('button').find(b => b.text() === 'Change')!
      await changeBtn.trigger('click')

      const passwordInput = wrapper.find('input[type="password"]')
      expect(passwordInput.exists()).toBe(true)
    })

    it('exits edit mode and emits masked sentinel when Cancel is clicked', async () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: '***', field: makeField({ type: 'password' }) },
        global,
      })

      // Enter edit mode by clicking Change
      const changeBtn = wrapper.findAll('button').find(b => b.text() === 'Change')!
      await changeBtn.trigger('click')

      // Type a new password
      const passwordInput = wrapper.find('input[type="password"]')
      await passwordInput.setValue('my new password')

      // Now click Cancel
      const cancelBtn = wrapper.findAll('button').find(b => b.text() === 'Cancel')!
      await cancelBtn.trigger('click')

      const events = wrapper.emitted('update:modelValue')
      expect(events).toBeTruthy()
      // Last event should be the '***' sentinel
      expect(events![events!.length - 1][0]).toBe('***')
    })
  })

  describe('error and disabled states', () => {
    it('shows the error message when error prop is set', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: '', field: makeField(), error: 'Required field' },
        global,
      })

      expect(wrapper.text()).toContain('Required field')
    })

    it('disables the input when disabled prop is true', () => {
      const wrapper = mount(ToolSettingField, {
        props: { modelValue: '', field: makeField(), disabled: true },
        global,
      })

      const input = wrapper.find('input[type="text"]')
      expect(input.attributes('disabled')).toBeDefined()
    })
  })

  describe('multi-select', () => {
    beforeEach(() => {
      mockApi.get.mockReset()
    })

    it('renders one checkbox per agent from the default endpoint', async () => {
      // api.get unwraps body.data, so the picker sees the agents array directly.
      mockApi.get.mockResolvedValueOnce({
        agents: [
          { id: 1, name: 'Legal Agent' },
          { id: 2, name: 'Sales Agent' },
        ],
      })

      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: [],
          field: makeField({ type: 'multi-select', key: 'allowed_target_agents', label: 'Allowed target agents' }),
        },
        global,
      })
      await flushPromises()

      expect(mockApi.get).toHaveBeenCalledWith('/agents?select=id,name')
      const checkboxes = wrapper.findAll('input[type="checkbox"]')
      expect(checkboxes.length).toBe(2)
      expect(wrapper.text()).toContain('Legal Agent')
      expect(wrapper.text()).toContain('Sales Agent')
      expect(wrapper.text()).toContain('#1')
      expect(wrapper.text()).toContain('#2')
    })

    it('uses the override endpoint when data_source is set', async () => {
      mockApi.get.mockResolvedValueOnce({ agents: [] })

      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: [],
          field: makeField({
            type: 'multi-select',
            key: 'allowed_target_agents',
            label: 'Allowed target agents',
            data_source: '/some/other/endpoint',
          }),
        },
        global,
      })
      await flushPromises()

      expect(mockApi.get).toHaveBeenCalledWith('/some/other/endpoint')
    })

    it('checking a checkbox emits a number[] with the new state', async () => {
      mockApi.get.mockResolvedValueOnce({
        agents: [
          { id: 1, name: 'Legal' },
          { id: 2, name: 'Sales' },
        ],
      })

      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: [],
          field: makeField({ type: 'multi-select', key: 'allowed_target_agents', label: 'Allowed' }),
        },
        global,
      })
      await flushPromises()

      const checkboxes = wrapper.findAll('input[type="checkbox"]')
      await checkboxes[0].setValue(true)
      await wrapper.setProps({ modelValue: [1] })
      await checkboxes[1].setValue(true)

      const events = wrapper.emitted('update:modelValue')
      expect(events).toBeTruthy()
      // The picker emits a JSON-encoded string so the parent's
      // `String($event ?? '')` coercion in the override form doesn't
      // collapse the array. The form initializer parses it back.
      expect(events![0][0]).toEqual('[1]')
      expect(events![1][0]).toEqual('[1,2]')
    })

    it('unchecking a checkbox removes the id from the emitted array', async () => {
      mockApi.get.mockResolvedValueOnce({
        agents: [
          { id: 1, name: 'Legal' },
          { id: 2, name: 'Sales' },
        ],
      })

      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: [1, 2],
          field: makeField({ type: 'multi-select', key: 'allowed_target_agents', label: 'Allowed' }),
        },
        global,
      })
      await flushPromises()

      const checkboxes = wrapper.findAll('input[type="checkbox"]')
      await checkboxes[0].setValue(false)

      const events = wrapper.emitted('update:modelValue')
      expect(events).toBeTruthy()
      expect(events![0][0]).toEqual('[2]')
    })

    it('selected IDs round-trip: existing selection is reflected as checked', async () => {
      mockApi.get.mockResolvedValueOnce({
        agents: [
          { id: 1, name: 'Legal' },
          { id: 2, name: 'Sales' },
          { id: 3, name: 'Support' },
        ],
      })

      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: [1, 3],
          field: makeField({ type: 'multi-select', key: 'allowed_target_agents', label: 'Allowed' }),
        },
        global,
      })
      await flushPromises()

      const checkboxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')
      expect((checkboxes[0].element as HTMLInputElement).checked).toBe(true)
      expect((checkboxes[1].element as HTMLInputElement).checked).toBe(false)
      expect((checkboxes[2].element as HTMLInputElement).checked).toBe(true)
    })

    it('preserves an empty array selection (required field)', async () => {
      mockApi.get.mockResolvedValueOnce({
        agents: [
          { id: 1, name: 'Legal' },
        ],
      })

      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: [],
          field: makeField({ type: 'multi-select', key: 'allowed_target_agents', label: 'Allowed', required: true }),
        },
        global,
      })
      await flushPromises()

      const checkboxes = wrapper.findAll('input[type="checkbox"]')
      expect(checkboxes.length).toBe(1)
      expect((checkboxes[0].element as HTMLInputElement).checked).toBe(false)
    })

    it('parses a JSON-stringified array modelValue into the checkbox state', async () => {
      mockApi.get.mockResolvedValueOnce({
        agents: [
          { id: 1, name: 'Legal' },
          { id: 2, name: 'Sales' },
        ],
      })

      const wrapper = mount(ToolSettingField, {
        props: {
          // Parent form coerces everything to Record<string, string>, so the
          // initial selection arrives as a JSON-encoded array string.
          modelValue: '[1]',
          field: makeField({ type: 'multi-select', key: 'allowed_target_agents', label: 'Allowed' }),
        },
        global,
      })
      await flushPromises()

      const checkboxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')
      expect((checkboxes[0].element as HTMLInputElement).checked).toBe(true)
      expect((checkboxes[1].element as HTMLInputElement).checked).toBe(false)
    })

    it('falls back to [] when the modelValue is not valid JSON', async () => {
      mockApi.get.mockResolvedValueOnce({
        agents: [
          { id: 1, name: 'Legal' },
        ],
      })

      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: 'not-json-at-all',
          field: makeField({ type: 'multi-select', key: 'allowed_target_agents', label: 'Allowed' }),
        },
        global,
      })
      await flushPromises()

      const checkboxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')
      expect((checkboxes[0].element as HTMLInputElement).checked).toBe(false)
    })

    it('re-fetches from the latest URL when data_source changes', async () => {
      mockApi.get.mockResolvedValueOnce({ skills: [{ name: 'git', description: 'Git helper' }] })
      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: [],
          field: makeField({
            type: 'multi-select',
            key: 'allowed_skills',
            label: 'Allowed skills',
            data_source: '/api/v1/skills?select=name,description',
          }),
        },
        global,
      })
      await flushPromises()
      expect(mockApi.get).toHaveBeenCalledTimes(1)

      mockApi.get.mockResolvedValueOnce({ agents: [{ id: 1, name: 'A' }] })
      await wrapper.setProps({
        field: makeField({
          type: 'multi-select',
          key: 'allowed_agents',
          label: 'Allowed agents',
          data_source: '/agents?select=id,name',
        }),
      })
      await flushPromises()
      expect(mockApi.get).toHaveBeenCalledTimes(2)
      expect(mockApi.get).toHaveBeenLastCalledWith('/agents?select=id,name')
    })

    it('renders the description as a sub-label under each checkbox', async () => {
      mockApi.get.mockResolvedValueOnce({
        skills: [
          { name: 'git', description: 'Git helper' },
          { name: 'pdf', description: '' },
        ],
      })

      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: [],
          field: makeField({
            type: 'multi-select',
            key: 'allowed_skills',
            label: 'Allowed skills',
            data_source: '/api/v1/skills?select=name,description',
          }),
        },
        global,
      })
      await flushPromises()

      expect(wrapper.text()).toContain('Git helper')
      // Empty descriptions don't render a stray colon-and-space.
      expect(wrapper.text()).toContain('pdf')
    })

    it('appends principal_id to the multi-select endpoint when principalId prop is set', async () => {
      mockApi.get.mockResolvedValueOnce({ agents: [] })

      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: [],
          field: makeField({
            type: 'multi-select',
            key: 'allowed_target_agents',
            label: 'Allowed target agents',
          }),
          principalId: 42,
        },
        global,
      })
      await flushPromises()

      // The source URL already has `?select=id,name`, so the principal
      // filter must be appended with `&`. Backend's AgentController
      // scopes by `?principal_id=` (single value) for HandoverTool.
      expect(mockApi.get).toHaveBeenCalledWith('/agents?select=id,name&principal_id=42')

      // Re-fetch on principalId change — same URL gets re-requested.
      mockApi.get.mockResolvedValueOnce({ agents: [] })
      await wrapper.setProps({ principalId: 99 })
      await flushPromises()
      expect(mockApi.get).toHaveBeenLastCalledWith('/agents?select=id,name&principal_id=99')
    })

    it('appends principal_id to an override data_source endpoint too', async () => {
      // Defensive: a backend tool that declares its own data_source still
      // gets scoped per-principal. This guards the SkillTool-style
      // absolute `/api/v1/skills?...` URL against an unintended double-`?`
      // or accidental overwrite of the existing query string.
      mockApi.get.mockResolvedValueOnce({ skills: [] })

      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: [],
          field: makeField({
            type: 'multi-select',
            key: 'allowed_skills',
            label: 'Allowed skills',
            data_source: '/api/v1/skills?select=name,description',
          }),
          principalId: 7,
        },
        global,
      })
      await flushPromises()

      expect(mockApi.get).toHaveBeenCalledWith(
        '/skills?select=name,description&principal_id=7',
      )
      expect(wrapper.text()).not.toContain('Loading options…')
    })

    it('renders empty options when the API rejects with the principalId set (fail-soft)', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('forbidden principal'))

      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: [],
          field: makeField({
            type: 'multi-select',
            key: 'allowed_target_agents',
            label: 'Allowed target agents',
          }),
          principalId: 42,
        },
        global,
      })
      await flushPromises()

      // No checkboxes rendered — the composable already swallows the
      // rejection into an empty list, so the user sees "No options
      // available." instead of an unhandled rejection in the console.
      const checkboxes = wrapper.findAll('input[type="checkbox"]')
      expect(checkboxes.length).toBe(0)
      expect(wrapper.text()).toContain('No options available.')
    })

    it('defaults to the legacy /agents?select=id,name endpoint when principalId is unset (regression)', async () => {
      mockApi.get.mockResolvedValueOnce({ agents: [] })

      const wrapper = mount(ToolSettingField, {
        props: {
          modelValue: [],
          field: makeField({
            type: 'multi-select',
            key: 'allowed_target_agents',
            label: 'Allowed target agents',
          }),
          // principalId is omitted on purpose — operator-defaults page.
        },
        global,
      })
      await flushPromises()

      expect(mockApi.get).toHaveBeenCalledWith('/agents?select=id,name')
      // Sanity: explicitly passing null also keeps the legacy endpoint.
      mockApi.get.mockResolvedValueOnce({ agents: [] })
      await wrapper.setProps({ principalId: null })
      await flushPromises()
      expect(mockApi.get).toHaveBeenLastCalledWith('/agents?select=id,name')
    })
  })

})
