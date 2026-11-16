/**
 * ScheduleEffortOverride — the run's own reasoning-effort level.
 *
 * The override has to have a rendered control: the field is in the form
 * state and in the payload, and a control nobody can reach is a field the
 * operator cannot set.
 */
import { flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: { get: apiGet },
}))

import ScheduleEffortOverride from '@/components/shared/ScheduleEditor/ScheduleEffortOverride.vue'
import { mountWithForm } from './_helpers'
import { clearAgentEffortCache } from '@/composables/agentEffortCache'
import type { ScheduleForm } from '@/composables/useScheduleForm'

function makeForm(): ScheduleForm {
  return {
    effortOverride: ref<string | null>(null),
    agentId: ref<number | null>(7),
  } as unknown as ScheduleForm
}

beforeEach(() => {
  setActivePinia(createPinia())
  apiGet.mockReset()
  clearAgentEffortCache()
})

describe('ScheduleEffortOverride', () => {
  it('renders a control for the run\'s effort override', async () => {
    apiGet.mockResolvedValue({
      supported: true,
      levels: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
      default: 'high',
    })
    const wrapper = mountWithForm(ScheduleEffortOverride, makeForm())
    await flushPromises()

    const select = wrapper.find('[data-testid="effort-select"]')
    expect(select.exists()).toBe(true)
    expect(wrapper.findAll('option').map(option => option.text())).toEqual([
      'Use the template default',
      'Low',
      'High',
    ])
  })

  it('writes the level the operator picked into the form', async () => {
    apiGet.mockResolvedValue({
      supported: true,
      levels: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
      default: 'high',
    })
    const form = makeForm()
    const wrapper = mountWithForm(ScheduleEffortOverride, form)
    await flushPromises()

    await wrapper.find('[data-testid="effort-select"]').setValue('high')
    expect(form.effortOverride.value).toBe('high')
  })

  it('writes inherit when the operator picks the empty entry', async () => {
    apiGet.mockResolvedValue({
      supported: true,
      levels: [{ value: 'high', label: 'High' }],
      default: 'high',
    })
    const form = makeForm()
    form.effortOverride.value = 'high'
    const wrapper = mountWithForm(ScheduleEffortOverride, form)
    await flushPromises()

    await wrapper.find('[data-testid="effort-select"]').setValue('')
    expect(form.effortOverride.value).toBeNull()
  })

  it('renders no control for an agent whose driver speaks no effort', async () => {
    apiGet.mockResolvedValue({ supported: false, levels: [], default: null })
    const wrapper = mountWithForm(ScheduleEffortOverride, makeForm())
    await flushPromises()

    expect(wrapper.find('[data-testid="effort-select"]').exists()).toBe(false)
  })
})
