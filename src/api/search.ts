import { api } from './client'
import type { SearchResponse } from '@/types/search'

/**
 * `GET /search` — the ⌘K palette's server-side index, aggregating every
 * registered `SearchProviderInterface`. The local palette sections (agents,
 * groups, chats) stay client-side and are deliberately not migrated here:
 * a provider for each of those would have to ship in spora-core first.
 *
 * `api.get` strips the `{ data: … }` envelope, so the caller reads
 * `SearchResponse` directly rather than reaching through a second wrapper.
 *
 * An empty query is answered with an empty hit list without reaching a single
 * provider, so the palette skips the call entirely on a cold open.
 */
export const searchApi = {
  search(query: string): Promise<SearchResponse> {
    return api.get<SearchResponse>('/search', { q: query })
  },
}