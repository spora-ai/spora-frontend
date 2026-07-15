import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useScheduledRunsStore } from './scheduledRuns'
import type { ScheduledRunResource } from '@/types/scheduledRun'

interface CacheEntry {
  runs: ScheduledRunResource[]
  expiresAt: number
}

const TTL_MS = 5 * 60 * 1000

/**
 * Caches scheduled runs per agent for five minutes to avoid duplicate dashboard requests.
 */
export const useScheduledRunsCache = defineStore('scheduledRunsCache', () => {
  const cache = ref(new Map<number, CacheEntry>())

  function isFresh(entry: CacheEntry | undefined): boolean {
    if (!entry) return false
    return Date.now() < entry.expiresAt
  }

  function getCached(id: number): ScheduledRunResource[] | undefined {
    const entry = cache.value.get(id)
    if (!isFresh(entry)) return undefined
    return entry?.runs
  }

  function setCached(id: number, runs: ScheduledRunResource[]): void {
    cache.value.set(id, { runs, expiresAt: Date.now() + TTL_MS })
  }

  async function loadForAgent(id: number): Promise<ScheduledRunResource[]> {
    const cached = getCached(id)
    if (cached) return cached

    const store = useScheduledRunsStore()
    const runs = await store.fetchRuns(id)
    setCached(id, runs)
    return runs
  }

  async function loadForAllAgents(
    ids: number[],
  ): Promise<Map<number, ScheduledRunResource[]>> {
    // Promise.all fans requests out in parallel instead of awaiting each agent serially.
    const pairs = await Promise.all(
      ids.map(async (id) => [id, await loadForAgent(id)] as const),
    )
    return new Map(pairs)
  }

  function invalidate(id: number): void {
    cache.value.delete(id)
  }

  return { cache, getCached, setCached, loadForAgent, loadForAllAgents, invalidate }
})
