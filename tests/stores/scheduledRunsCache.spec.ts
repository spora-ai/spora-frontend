import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledRunResource } from '@/types/scheduledRun'

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn<(path: string) => Promise<{ scheduled_runs: ScheduledRunResource[] }>>(),
}))

vi.mock('@/api/client', () => ({
  api: { get: apiGet },
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
    apiGet.mockReset()
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
    apiGet.mockResolvedValue({ scheduled_runs: runs })
    const store = useScheduledRunsCache()

    await expect(store.loadForAgent(10)).resolves.toEqual(runs)
    await expect(store.loadForAgent(10)).resolves.toEqual(runs)

    expect(apiGet).toHaveBeenCalledTimes(1)
    expect(apiGet).toHaveBeenCalledWith('/agents/10/scheduled-runs')
    expect(store.getCached(10)).toEqual(runs)
  })

  it('coalesces concurrent loadForAgent calls for the same id', async () => {
    const runs = [sampleRun]
    let resolveApi: (value: { scheduled_runs: ScheduledRunResource[] }) => void = () => {}
    apiGet.mockImplementation(
      () => new Promise<{ scheduled_runs: ScheduledRunResource[] }>((resolve) => {
        resolveApi = resolve
      }),
    )
    const store = useScheduledRunsCache()

    const first = store.loadForAgent(10)
    const second = store.loadForAgent(10)

    resolveApi({ scheduled_runs: runs })

    await expect(first).resolves.toEqual(runs)
    await expect(second).resolves.toEqual(runs)

    // Both callers share a single inflight request.
    expect(apiGet).toHaveBeenCalledTimes(1)
  })

  it('loads all agents with one request per id', async () => {
    apiGet.mockImplementation(async (path: string) => {
      const id = Number(path.split('/')[2])
      return { scheduled_runs: [{ ...sampleRun, agent_id: id }] }
    })
    const store = useScheduledRunsCache()

    const result = await store.loadForAllAgents([10, 20, 30])

    expect(apiGet).toHaveBeenCalledTimes(3)
    expect(apiGet).toHaveBeenCalledWith('/agents/10/scheduled-runs')
    expect(apiGet).toHaveBeenCalledWith('/agents/20/scheduled-runs')
    expect(apiGet).toHaveBeenCalledWith('/agents/30/scheduled-runs')
    expect([...result.keys()]).toEqual([10, 20, 30])
  })

  it('invalidates a cached entry', () => {
    const store = useScheduledRunsCache()
    store.setCached(10, [sampleRun])

    store.invalidate(10)

    expect(store.getCached(10)).toBeUndefined()
  })
})