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
 * Single source of truth for scheduled runs.
 *
 * Combines the previous `useScheduledRunsStore` CRUD store with the
 * `useScheduledRunsCache` per-agent TTL cache. Pages (the editor) and
 * widgets (the dashboard "scheduled today" KPI + per-card chip) both
 * read from this one store, so a mutation in the editor invalidates
 * the dashboard's cached view without a separate cross-store call.
 *
 * `loadForAgent` is the cache read with single-flight inflight
 * deduping — two concurrent `loadForAgent(sameId)` calls share one
 * network request, both callers receive the same promise.
 *
 * Mutation actions (`createRun`, `updateRun`, `toggleActive`,
 * `deleteRun`, `triggerRun`) update the matching cached entry in
 * place, so the next consumer reads the fresh row. Pages that maintain
 * their own local working copy (e.g. `ScheduledRunsPage`) are
 * responsible for updating their local state and calling `invalidate`
 * to force the next dashboard read to re-fetch.
 */
export const useScheduledRunsStore = defineStore('scheduledRuns', () => {
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

  function patchCached(id: number, run: ScheduledRunResource): void {
    const entry = cache.value.get(id)
    if (!entry || !isFresh(entry)) return
    const idx = entry.runs.findIndex((r) => r.id === run.id)
    if (idx !== -1) {
      entry.runs[idx] = run
      // Replace the array reference so Vue's reactivity picks up the
      // mutation — `entry.runs` is a property of a Map value and is
      // not deeply reactive.
      cache.value.set(id, { runs: [...entry.runs], expiresAt: entry.expiresAt })
    }
  }

  function removeCached(id: number, runId: number): void {
    const entry = cache.value.get(id)
    if (!entry || !isFresh(entry)) return
    cache.value.set(id, {
      runs: entry.runs.filter((r) => r.id !== runId),
      expiresAt: entry.expiresAt,
    })
  }

  function prependCached(id: number, run: ScheduledRunResource): void {
    const entry = cache.value.get(id)
    if (!entry || !isFresh(entry)) return
    cache.value.set(id, {
      runs: [run, ...entry.runs],
      expiresAt: entry.expiresAt,
    })
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

  function invalidateAll(): void {
    cache.value.clear()
  }

  // ── mutations ──────────────────────────────────────────────────────

  async function createRun(
    agentId: number,
    payload: Record<string, unknown>,
  ): Promise<ScheduledRunResource> {
    const result = await api.post<{ scheduled_run: ScheduledRunResource }>(
      `/agents/${agentId}/scheduled-runs`,
      payload,
    )
    prependCached(agentId, result.scheduled_run)
    return result.scheduled_run
  }

  async function updateRun(
    agentId: number,
    runId: number,
    payload: Record<string, unknown>,
  ): Promise<ScheduledRunResource> {
    const result = await api.put<{ scheduled_run: ScheduledRunResource }>(
      `/agents/${agentId}/scheduled-runs/${runId}`,
      payload,
    )
    patchCached(agentId, result.scheduled_run)
    return result.scheduled_run
  }

  async function toggleActive(run: ScheduledRunResource): Promise<ScheduledRunResource> {
    return updateRun(run.agent_id, run.id, { is_active: !run.is_active })
  }

  async function deleteRun(agentId: number, runId: number): Promise<void> {
    await api.delete(`/agents/${agentId}/scheduled-runs/${runId}`)
    removeCached(agentId, runId)
  }

  async function triggerRun(agentId: number, runId: number): Promise<void> {
    await api.post<{ scheduled_run: ScheduledRunResource }>(
      `/agents/${agentId}/scheduled-runs/${runId}/trigger`,
    )
    // The trigger endpoint doesn't return the updated run; force the
    // dashboard's next read to re-fetch by invalidating the cache. The
    // editor page refetches explicitly via `loadData()`.
    invalidate(agentId)
  }

  return {
    cache,
    getCached,
    loadForAgent,
    loadForAllAgents,
    invalidate,
    invalidateAll,
    createRun,
    updateRun,
    toggleActive,
    deleteRun,
    triggerRun,
  }
})
