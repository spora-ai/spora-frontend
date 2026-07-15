import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'
import type { ScheduledRunResource } from '@/types/scheduledRun'

interface CacheEntry {
  runs: ScheduledRunResource[]
  expiresAt: number
}

const TTL_MS = 5 * 60 * 1000

/**
 * Caches scheduled runs per agent for five minutes to avoid duplicate dashboard requests.
 *
 * `loadForAgent` calls the API directly (rather than going through
 * `useScheduledRunsStore().fetchRuns`) so that `loadForAllAgents` can fan out
 * concurrent requests without one call's response stomping the shared
 * store's `runs` ref with another agent's runs. The endpoint and response
 * shape are identical to `useScheduledRunsStore.fetchRuns`; we re-declare
 * the path here so the cache store has no coupling to the runs store.
 *
 * A single-flight inflight Map (id → Promise<runs>) prevents two concurrent
 * `loadForAgent(sameId)` calls from issuing duplicate network requests;
 * both callers receive the same promise.
 */
export const useScheduledRunsCache = defineStore('scheduledRunsCache', () => {
  const cache = ref(new Map<number, CacheEntry>())
  const inflight = new Map<number, Promise<ScheduledRunResource[]>>()

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

    const existing = inflight.get(id)
    if (existing) return existing

    const promise = (async (): Promise<ScheduledRunResource[]> => {
      try {
        const result = await api.get<{ scheduled_runs: ScheduledRunResource[] }>(
          `/agents/${id}/scheduled-runs`,
        )
        const runs = result.scheduled_runs
        setCached(id, runs)
        return runs
      } finally {
        inflight.delete(id)
      }
    })()

    inflight.set(id, promise)
    return promise
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