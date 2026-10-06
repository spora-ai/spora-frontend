/**
 * Shapes returned by spora-core's `GET /api/v1/search` — the one index the
 * host ⌘K palette queries, aggregating every search provider a plugin
 * registers. spora-core ships no provider of its own: skill search lives in
 * spora-plugin-custom-skills, media-asset search in spora-plugin-media-archive.
 *
 * Mirrors `Spora\Search\SearchHit::toArray()` field for field.
 */

export interface SearchHit {
  /**
   * Provider-chosen group name (`skill` from the custom-skills plugin,
   * `media-archive` from the media-archive plugin).
   * The palette renders one section per distinct `type`, in the order the
   * backend emitted them, so a provider's own ranking survives grouping.
   */
  type: string
  /** Stable within `type` — what the backend de-duplicates on. */
  id: string
  label: string
  /** Secondary text, usually a description. Null when the provider has none. */
  subLabel: string | null
  /** Short status text, e.g. `1 warning`. Null when there is nothing to flag. */
  badge: string | null
  /**
   * Host route to open on select, or null when none exists.
   *
   * Nullable by design, not an oversight: the host has no page for every
   * searchable thing — none for skills at all — so a provider that cannot
   * name a destination says so rather than inventing a 404. The palette
   * therefore renders a null-`href` hit but never makes it activatable.
   */
  href: string | null
}

/**
 * `{ data: { hits, query } }` with the envelope already stripped — `api.get`
 * unwraps `body.data`, so callers read this shape directly.
 */
export interface SearchResponse {
  hits: SearchHit[]
  /** The query the backend actually searched for, after clamping. */
  query: string
}