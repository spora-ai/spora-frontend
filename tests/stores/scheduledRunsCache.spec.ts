import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledRunResource } from '@/types/scheduledRun'

const fetchRuns = vi.fn<(id: number) => Promise<ScheduledRunResource[]>>()

vi.mock('@/stores/scheduledRuns', () => ({
  useScheduledRunsStore: () => ({ fetchRuns }),
}))

import { useScheduledRunsCache } from '@/stores/scheduledRunsCache'

const sampleRun: ScheduledRunResource = {
  id: 1,
  agent_id: 10,
  template_id: null,
  raw_prompt: 'Summarize the day',
  cron_expression: '0 9 * * *',
  run_at: null,
  timezone: 'UTC',
  max_steps_override: null,
  is_active: true,
  last_run_at: null,
  next_run_at: '2026-07-16T09:00:00Z',
  created_at: '2026-07-15T00:00:00Z',
  updated_at: '2026-07-15T00:00:00Z',
}

describe('useScheduledRunsCache', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchRuns.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns fresh entries and rejects them after five minutes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T00:00:00Z'))
    const store = useScheduledRunsCache()
    const runs = [sampleRun]

    store.setCached(10, runs)

    expect(store.getCached(10)).toEqual(runs)

    vi.advanceTimersByTime(5 * 60 * 1000)

    expect(store.getCached(10)).toBeUndefined()
  })

  it('fetches an agent once and serves subsequent loads from the cache', async () => {
    const runs = [sampleRun]
    fetchRuns.mockResolvedValue(runs)
    const store = useScheduledRunsCache()

    await expect(store.loadForAgent(10)).resolves.toEqual(runs)
    await expect(store.loadForAgent(10)).resolves.toEqual(runs)

    expect(fetchRuns).toHaveBeenCalledOnce()
    expect(fetchRuns).toHaveBeenCalledWith(10)
    expect(store.getCached(10)).toEqual(runs)
  })

  it('loads all agents with one request per id', async () => {
    fetchRuns.mockImplementation(async (id) => [{ ...sampleRun, agent_id: id }])
    const store = useScheduledRunsCache()

    const result = await store.loadForAllAgents([10, 20, 30])

    expect(fetchRuns).toHaveBeenCalledTimes(3)
    expect(fetchRuns).toHaveBeenCalledWith(10)
    expect(fetchRuns).toHaveBeenCalledWith(20)
    expect(fetchRuns).toHaveBeenCalledWith(30)
    expect([...result.keys()]).toEqual([10, 20, 30])
  })

  it('invalidates a cached entry', () => {
    const store = useScheduledRunsCache()
    store.setCached(10, [sampleRun])

    store.invalidate(10)

    expect(store.getCached(10)).toBeUndefined()
  })
})
