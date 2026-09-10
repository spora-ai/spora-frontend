import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import { api } from '@/api/client'
import { useScheduledRunsStore } from '@/stores/scheduledRuns'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

const sampleRun = {
  id: 1,
  agent_id: 10,
  name: 'Daily summary',
  cron_expression: '0 9 * * *',
  prompt: 'Summarize',
  enabled: true,
  is_active: true,
  next_run_at: '2026-01-02T09:00:00Z',
  last_run_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  template_id: null,
  template_name: null,
  raw_prompt: null,
  run_at: null,
  timezone: 'UTC',
  max_steps_override: null,
}

describe('useScheduledRunsStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  describe('cache', () => {
    it('loadForAgent fetches and caches runs', async () => {
      mockApi.get.mockResolvedValueOnce({ scheduled_runs: [sampleRun] })
      const store = useScheduledRunsStore()
      const result = await store.loadForAgent(10)
      expect(mockApi.get).toHaveBeenCalledWith('/agents/10/scheduled-runs')
      expect(result).toEqual([sampleRun])
      expect(store.getCached(10)).toEqual([sampleRun])
    })

    it('loadForAgent returns fresh cache without re-fetching', async () => {
      mockApi.get.mockResolvedValueOnce({ scheduled_runs: [sampleRun] })
      const store = useScheduledRunsStore()
      await store.loadForAgent(10)
      mockApi.get.mockClear()
      const result = await store.loadForAgent(10)
      expect(mockApi.get).not.toHaveBeenCalled()
      expect(result).toEqual([sampleRun])
    })

    it('loadForAgent single-flights concurrent calls', async () => {
      let resolveFetch: (value: { scheduled_runs: typeof sampleRun[] }) => void
      mockApi.get.mockImplementationOnce(() => new Promise((resolve) => {
        resolveFetch = resolve
      }))
      const store = useScheduledRunsStore()
      const first = store.loadForAgent(10)
      const second = store.loadForAgent(10)
      // Both calls return the same pending promise; only one fetch was issued.
      expect(mockApi.get).toHaveBeenCalledTimes(1)
      resolveFetch!({ scheduled_runs: [sampleRun] })
      await Promise.all([first, second])
    })

    it('invalidate drops the cached entry', async () => {
      mockApi.get.mockResolvedValue({ scheduled_runs: [sampleRun] })
      const store = useScheduledRunsStore()
      await store.loadForAgent(10)
      store.invalidate(10)
      expect(store.getCached(10)).toBeUndefined()
    })
  })

  describe('mutations', () => {
    it('createRun prepends to the cached entry', async () => {
      mockApi.get.mockResolvedValueOnce({ scheduled_runs: [] })
      mockApi.post.mockResolvedValueOnce({ scheduled_run: sampleRun })
      const store = useScheduledRunsStore()
      await store.loadForAgent(10)
      const result = await store.createRun(10, { name: 'Daily summary' })
      expect(result).toEqual(sampleRun)
      expect(store.getCached(10)).toEqual([sampleRun])
    })

    it('updateRun patches the matching cached row', async () => {
      const updated = { ...sampleRun, name: 'Updated' }
      mockApi.get.mockResolvedValueOnce({ scheduled_runs: [sampleRun] })
      mockApi.put.mockResolvedValueOnce({ scheduled_run: updated })
      const store = useScheduledRunsStore()
      await store.loadForAgent(10)
      const result = await store.updateRun(10, 1, { name: 'Updated' })
      expect(result).toEqual(updated)
      expect(store.getCached(10)?.[0].name).toBe('Updated')
    })

    it('toggleActive flips is_active and patches the cache', async () => {
      const flipped = { ...sampleRun, is_active: false }
      mockApi.get.mockResolvedValueOnce({ scheduled_runs: [sampleRun] })
      mockApi.put.mockResolvedValueOnce({ scheduled_run: flipped })
      const store = useScheduledRunsStore()
      await store.loadForAgent(10)
      const result = await store.toggleActive(sampleRun)
      expect(mockApi.put).toHaveBeenCalledWith(
        '/agents/10/scheduled-runs/1',
        { is_active: false },
      )
      expect(result).toEqual(flipped)
      expect(store.getCached(10)?.[0].is_active).toBe(false)
    })

    it('deleteRun removes the row from the cache', async () => {
      const other = { ...sampleRun, id: 2 }
      mockApi.get.mockResolvedValueOnce({ scheduled_runs: [sampleRun, other] })
      mockApi.delete.mockResolvedValueOnce(undefined)
      const store = useScheduledRunsStore()
      await store.loadForAgent(10)
      await store.deleteRun(10, 1)
      expect(mockApi.delete).toHaveBeenCalledWith('/agents/10/scheduled-runs/1')
      expect(store.getCached(10)?.map((r) => r.id)).toEqual([2])
    })

    it('triggerRun invalidates the cache (the trigger endpoint returns no payload)', async () => {
      mockApi.get.mockResolvedValueOnce({ scheduled_runs: [sampleRun] })
      mockApi.post.mockResolvedValueOnce({ scheduled_run: sampleRun })
      const store = useScheduledRunsStore()
      await store.loadForAgent(10)
      await store.triggerRun(10, 1)
      expect(mockApi.post).toHaveBeenCalledWith('/agents/10/scheduled-runs/1/trigger')
      expect(store.getCached(10)).toBeUndefined()
    })
  })
})
