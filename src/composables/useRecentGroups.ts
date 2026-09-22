/**
 * useRecentGroups — MRU list of group ids the operator has visited.
 *
 * localStorage-backed, not server-backed. Recents is a UX hint
 * scoped to this browser — the group list itself is server-scoped,
 * so a new endpoint + migration for "recently visited" would be pure
 * overhead. Logout/login on a shared browser briefly shows stale
 * recents until the operator visits a group; accepted.
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
    // SSR) — start fresh; the in-memory ref still reflects later visits.
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
    // Eager write (not debounced) so a `recordVisit` at the cap still
    // persists the new head, matching the in-memory ref.
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
