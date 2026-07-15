/**
 * DashboardKpiCard — verifies the data-kpi attribute, active-state styling,
 * pulse-light rendering, and select-event bubbling.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import DashboardKpiCard from '@/components/dashboard/DashboardKpiCard.vue'

describe('DashboardKpiCard', () => {
  it('renders the label, count, and description', () => {
    const wrapper = mount(DashboardKpiCard, {
      props: {
        label: 'Running',
        count: 2,
        accent: 'running',
        kpiKey: 'RUNNING',
        description: 'tasks in flight',
      },
    })

    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.attributes('data-kpi')).toBe('RUNNING')
    expect(wrapper.attributes('data-active')).toBe('false')
    expect(wrapper.text()).toContain('Running')
    expect(wrapper.text()).toContain('2')
    expect(wrapper.text()).toContain('tasks in flight')
    // The accent class names the per-KPI top-border color.
    expect(wrapper.classes()).toContain('kpi-running')
  })

  it('emits select with the kpiKey when clicked', async () => {
    const wrapper = mount(DashboardKpiCard, {
      props: {
        label: 'Awaiting input',
        count: 3,
        accent: 'awaiting',
        kpiKey: 'AWAITING',
      },
    })

    await wrapper.trigger('click')

    const events = wrapper.emitted('select')
    expect(events).toBeTruthy()
    expect(events).toHaveLength(1)
    expect(events![0]).toEqual(['AWAITING'])
  })

  it('reflects the active prop on the data-active attribute', () => {
    const active = mount(DashboardKpiCard, {
      props: {
        label: 'Agents',
        count: 12,
        accent: 'all',
        kpiKey: 'all',
        active: true,
      },
    })
    expect(active.attributes('data-active')).toBe('true')

    const inactive = mount(DashboardKpiCard, {
      props: {
        label: 'Agents',
        count: 12,
        accent: 'all',
        kpiKey: 'all',
        active: false,
      },
    })
    expect(inactive.attributes('data-active')).toBe('false')
  })

  it('renders the pulse light and tag when pulseClass is set', () => {
    const wrapper = mount(DashboardKpiCard, {
      props: {
        label: 'Running',
        count: 2,
        accent: 'running',
        kpiKey: 'RUNNING',
        pulseClass: 'live',
      },
    })

    expect(wrapper.find('.pulse-light').exists()).toBe(true)
    expect(wrapper.find('.pulse-light-running').exists()).toBe(true)
    expect(wrapper.find('.pulse-tag').text()).toBe('live')
  })

  it('omits the pulse light when pulseClass is null', () => {
    const wrapper = mount(DashboardKpiCard, {
      props: {
        label: 'Agents',
        count: 12,
        accent: 'all',
        kpiKey: 'all',
      },
    })

    expect(wrapper.find('.pulse-light').exists()).toBe(false)
  })

  it('maps each pulseClass to its accent color and animation', () => {
    const cases = [
      { pulseClass: 'live', color: 'text-blue-600', anim: 'pulse-light-running', tag: 'live' },
      { pulseClass: 'you', color: 'text-amber-600', anim: 'pulse-light-awaiting', tag: 'you' },
      { pulseClass: 'soon', color: 'text-violet-600', anim: 'pulse-light-static', tag: 'soon' },
    ] as const

    for (const tc of cases) {
      const wrapper = mount(DashboardKpiCard, {
        props: {
          label: 'P',
          count: 1,
          accent: 'all',
          kpiKey: 'all',
          pulseClass: tc.pulseClass,
        },
      })
      const wrap = wrapper.find('.pulse-light-wrap')
      expect(wrap.classes(tc.color)).toBe(true)
      expect(wrapper.find(`.${tc.anim}`).exists()).toBe(true)
      expect(wrapper.find('.pulse-tag').text()).toBe(tc.tag)
    }
  })

  it('renders string counts verbatim (covers the loading "/ 12" form)', () => {
    const wrapper = mount(DashboardKpiCard, {
      props: {
        label: 'Agents',
        count: '—',
        accent: 'all',
        kpiKey: 'all',
      },
    })
    expect(wrapper.text()).toContain('—')
  })
})
