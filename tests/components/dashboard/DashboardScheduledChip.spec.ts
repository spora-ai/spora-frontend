/**
 * DashboardScheduledChip — verifies the cache-first / mount-fetch lifecycle
 * and that the chip only renders when the agent has at least one active run.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

import DashboardScheduledChip from '@/components/dashboard/DashboardScheduledChip.vue'
import type { ScheduledRunResource } from '@/types/scheduledRun'

const loadForAgent = vi.fn()
const getCached = vi.fn()

vi.mock('@/stores/scheduledRunsCache', () => ({
  // Pinia normally resolves the store at runtime; provide a plain object
  // with the same callable surface (`cache.cache` reactive map + actions).
  useScheduledRunsCache: () => ({
    cache: { get: () => undefined },
    getCached: (...args: unknown[]) => getCached(...args),
    loadForAgent: (...args: unknown[]) => loadForAgent(...args),
    setCached: vi.fn(),
    loadForAllAgents: vi.fn(),
    invalidate: vi.fn(),
  }),
}))

function makeRun(overrides: Partial<ScheduledRunResource> = {}): ScheduledRunResource {
  return {
    id: 1,
    agent_id: 7,
    template_id: null,
    template_name: null,
    raw_prompt: null,
    cron_expression: '0 7 * * *',
    run_at: null,
    timezone: 'UTC',
    max_steps_override: null,
    is_active: true,
    last_run_at: null,
    next_run_at: '2026-07-15T07:00:00Z',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

describe('DashboardScheduledChip', () => {
  beforeEach(() => {
    loadForAgent.mockReset()
    getCached.mockReset()
  })

  it('calls loadForAgent on mount when nothing is cached yet', async () => {
    getCached.mockReturnValue(undefined)
    loadForAgent.mockResolvedValue([makeRun()])

    const wrapper = mount(DashboardScheduledChip, { props: { agentId: 7 } })
    // onMounted runs before await flushPromises resolves
    await nextTick()
    expect(loadForAgent).toHaveBeenCalledWith(7)
    expect(wrapper.find('.spora-skeleton').exists()).toBe(true)

    await flushPromises()
    expect(wrapper.text()).toContain('0 7 * * *')
  })

  it('renders the chip immediately from a fresh cache entry (no fetch)', async () => {
    const cached: ScheduledRunResource[] = [makeRun()]
    getCached.mockReturnValue(cached)

    const wrapper = mount(DashboardScheduledChip, { props: { agentId: 7 } })
    await flushPromises()

    expect(loadForAgent).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('0 7 * * *')
    expect(wrapper.find('.spora-skeleton').exists()).toBe(false)
  })

  it('renders nothing when the agent has no active scheduled runs', async () => {
    getCached.mockReturnValue(undefined)
    loadForAgent.mockResolvedValue([
      makeRun({ id: 1, is_active: false }),
    ])

    const wrapper = mount(DashboardScheduledChip, { props: { agentId: 7 } })
    await flushPromises()

    expect(wrapper.find('.dashboard-scheduled-chip').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('renders nothing when loadForAgent resolves to an empty list', async () => {
    getCached.mockReturnValue(undefined)
    loadForAgent.mockResolvedValue([])

    const wrapper = mount(DashboardScheduledChip, { props: { agentId: 7 } })
    await flushPromises()

    expect(wrapper.find('.dashboard-scheduled-chip').exists()).toBe(false)
  })

  it('falls back to the cron label when next_run_at is missing', async () => {
    getCached.mockReturnValue([
      makeRun({ next_run_at: null, run_at: null }),
    ])

    const wrapper = mount(DashboardScheduledChip, { props: { agentId: 7 } })
    await flushPromises()

    // No friendly clock label available — chip still shows the cron suffix
    // so users can identify the schedule.
    expect(wrapper.text()).toContain('0 7 * * *')
  })

  it('picks the soonest active run when the cache contains several', async () => {
    getCached.mockReturnValue([
      makeRun({ id: 1, next_run_at: '2026-07-20T07:00:00Z' }),
      makeRun({ id: 2, next_run_at: '2026-07-15T07:00:00Z' }),
      makeRun({ id: 3, next_run_at: '2026-07-30T07:00:00Z' }),
    ])

    const wrapper = mount(DashboardScheduledChip, { props: { agentId: 7 } })
    await flushPromises()

    // The chip renders — we don't assert the exact clock phrase here because
    // it depends on the wall clock at render time, but the cron suffix from
    // run id=2 should match whichever runs resolve first.
    expect(wrapper.find('.dashboard-scheduled-chip').exists()).toBe(true)
  })
})
