/**
 * useRecentGroups — MRU list of group ids the operator has visited.
 *
 * Powers "recently used on top" in the navbar's group sheet. Each time
 * the active group id changes (or the operator clicks a tile in the
 * drawer) the new id is moved to the front of the list and deduped. The
 * list is capped at `MAX_RECENT` so localStorage doesn't grow unbounded
 * for users with many groups.
 *
 * **Storage choice — localStorage, not the server.** Recents is a UX
 * hint, not a domain fact. The groups themselves are user-scoped on the
 * server, so the recents list is naturally scoped to whoever is signed
 * in on this browser. Storing it server-side would require a new
 * endpoint and migration; localStorage matches the lifetime of the
 * decision (per-browser, per-device) and avoids a round-trip on every
 * navbar mount. A `markStale()`-style per-user fingerprint lives in
 * the groups store for the actual list cache; we accept that
 * logout/login on a shared browser briefly shows stale recents until
 * the operator visits a group.
 */
import { ref, type Ref } from 'vue'

export interface UseRecentGroups {
  recentIds: Ref<number[]>
  recordVisit(id: number): void
  clear(): void
}

const STORAGE_KEY = 'spora.groups.recent.v1'
const MAX_RECENT = 10

function readStored(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  } catch {
    // Corrupt JSON or storage unavailable (private browsing, WebView,
    // SSR) — start fresh. The in-memory ref still reflects subsequent
    // visits for the session.
    return []
  }
}

function writeStored(ids: number[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Storage unavailable — keep the in-memory ref only.
  }
}

export function useRecentGroups(): UseRecentGroups {
  const recentIds = ref<number[]>(readStored())

  function recordVisit(id: number): void {
    // Move-to-front, dedupe, cap. Single source of localStorage writes —
    // eager so a `recordVisit` while already at the cap still persists
    // the new head, mirroring the in-memory ref exactly.
    const next = [id, ...recentIds.value.filter((existing) => existing !== id)].slice(0, MAX_RECENT)
    recentIds.value = next
    writeStored(next)
  }

  function clear(): void {
    recentIds.value = []
    writeStored([])
  }

  return { recentIds, recordVisit, clear }
}
