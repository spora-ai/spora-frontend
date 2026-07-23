/**
 * useComposerDrafts — sessionStorage persistence for in-progress composer
 * prompts (text + attachment chips).
 *
 * The agent store owns the reactive draft map (so it can wire a deep watcher that
 * auto-persists), but the load/save round-trip is a pure utility that doesn't
 * depend on Vue or Pinia — useful for testing the edge cases in isolation
 * (corrupt JSON, sessionStorage disabled in private browsing, etc.).
 */
import type { MediaAsset } from '@/types/media'

const COMPOSER_DRAFTS_KEY = 'spora:composer-drafts'

export interface ComposerDraft {
  promptText: string
  attachments: MediaAsset[]
}

export type ComposerDraftsMap = Record<number, ComposerDraft>

/**
 * Coerce a raw persisted blob into a fully-populated `ComposerDraft`.
 * Pre-attachments drafts were `{ promptText }` only; missing `attachments`
 * is treated as an empty array so legacy data continues to round-trip.
 */
function normalizeDraft(raw: unknown): ComposerDraft {
  if (raw === null || typeof raw !== 'object') {
    return { promptText: '', attachments: [] }
  }
  const candidate = raw as Partial<ComposerDraft>
  return {
    promptText: typeof candidate.promptText === 'string' ? candidate.promptText : '',
    attachments: Array.isArray(candidate.attachments)
      ? candidate.attachments.filter(isMediaAsset)
      : [],
  }
}

function isMediaAsset(value: unknown): value is MediaAsset {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<MediaAsset>
  return typeof candidate.id === 'string'
}

/** Read the persisted drafts from sessionStorage. Tolerates missing/disabled storage. */
export function loadComposerDrafts(): ComposerDraftsMap {
  try {
    const stored = sessionStorage.getItem(COMPOSER_DRAFTS_KEY)
    if (!stored) {
      return {}
    }
    const parsed = JSON.parse(stored) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const result: ComposerDraftsMap = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const agentId = Number(key)
      if (!Number.isInteger(agentId)) {
        continue
      }
      result[agentId] = normalizeDraft(value)
    }
    return result
  } catch {
    return {}
  }
}

/** Write the drafts to sessionStorage. Silently no-ops when storage is unavailable. */
export function saveComposerDrafts(drafts: ComposerDraftsMap): void {
  try {
    sessionStorage.setItem(COMPOSER_DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    // sessionStorage may be unavailable (e.g., private browsing) — drafts remain in memory.
  }
}
