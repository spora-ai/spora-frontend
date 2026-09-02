/**
 * useMediaAssetCache — module-level cache + batch resolver for
 * `MediaAsset` payloads the chat list needs to render attachment chips.
 *
 * The backend `task_history.attachments` field carries ref-only entries
 * (`{media_id, kind}`) — see `HistoryAttachment` — and resolves them
 * through `POST /api/v1/media/resolve`. The chat list renders every
 * `entry.attachments[*].media_id` it sees, so resolving inline via a
 * `MediaPickerOverlay`-style per-id fetch would N+1. This composable
 * batches unknown ids in a single network call and caches the resolved
 * assets in memory for the page session.
 *
 * The cache lives at module scope (not behind `ref`s) because the
 * resolved assets don't need to be reactive — components only re-read
 * when the dependency id list changes, which happens on history growth.
 * Clearing on route change is the caller's responsibility (handled by
 * `clearMediaAssetCache`).
 */
import type { MediaAsset } from '@/types/media'
import { api } from '@/api/client'

/** Backend hard cap on ids per `POST /media/resolve` request. */
const BATCH_LIMIT = 64

const cache = new Map<string, MediaAsset>()
const inflight = new Map<string, Promise<Map<string, MediaAsset>>>()

interface ResolveResponse {
  data: {
    assets: MediaAsset[]
  }
}

export interface MediaAssetCache {
  /**
   * Resolve a list of Media Archive UUIDs to their `MediaAsset` payloads.
   * Returns a map keyed by id; ids the caller cannot access (or that
   * don't exist) are silently absent from the map. Cached entries are
   * served without a network round trip; unknown entries are batched
   * through `POST /media/resolve` in chunks of {@link BATCH_LIMIT}.
   */
  batchResolve(ids: readonly string[]): Promise<Map<string, MediaAsset>>

  /**
   * Synchronous accessor for a single previously-resolved asset. Returns
   * `null` when the id has never been batched through `batchResolve` —
   * callers should fall back to a skeleton chip in that case rather
   * than firing a per-id request.
   */
  get(id: string): MediaAsset | null
}

export function useMediaAssetCache(): MediaAssetCache {
  return {
    batchResolve,
    get,
  }
}

async function batchResolve(ids: readonly string[]): Promise<Map<string, MediaAsset>> {
  if (ids.length === 0) {
    return new Map()
  }

  const unique = Array.from(new Set(ids))
  const result = new Map<string, MediaAsset>()
  const missing: string[] = []
  for (const id of unique) {
    const hit = cache.get(id)
    if (hit !== undefined) {
      result.set(id, hit)
    } else {
      missing.push(id)
    }
  }
  if (missing.length === 0) {
    return result
  }

  // Chunk to the backend cap so a chat with hundreds of attachment
  // refs across the full history does not blow the request payload.
  for (let offset = 0; offset < missing.length; offset += BATCH_LIMIT) {
    const chunk = missing.slice(offset, offset + BATCH_LIMIT)
    const resolved = await resolveChunk(chunk)
    for (const [id, asset] of resolved) {
      cache.set(id, asset)
      result.set(id, asset)
    }
  }

  return result
}

async function resolveChunk(ids: readonly string[]): Promise<Map<string, MediaAsset>> {
  const cacheKey = ids.slice().sort().join(',')
  const pending = inflight.get(cacheKey)
  if (pending !== undefined) {
    return pending
  }

  const request = (async (): Promise<Map<string, MediaAsset>> => {
    const response = await api.post<ResolveResponse>('/media/resolve', { ids: [...ids] })
    const assets = response.data.assets
    const out = new Map<string, MediaAsset>()
    for (const asset of assets) {
      out.set(asset.id, asset)
    }
    return out
  })()

  inflight.set(cacheKey, request)
  try {
    return await request
  } finally {
    inflight.delete(cacheKey)
  }
}

function get(id: string): MediaAsset | null {
  return cache.get(id) ?? null
}

/**
 * Drop the module-level cache. Test setup + route leaves call this so
 * a fresh chat list does not surface a stale asset row from the
 * previous task.
 */
export function clearMediaAssetCache(): void {
  cache.clear()
  inflight.clear()
}
