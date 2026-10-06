/**
 * Shapes returned by spora-core's `GET /api/v1/search` — the one index the
 * host ⌘K palette queries, aggregating every search provider a plugin
 * registers. spora-core ships no provider of its own, so what the palette can
 * render depends entirely on which plugins are installed. Today
 * spora-plugin-media-archive ships the only provider on its `main` (media
 * assets); a custom-skills provider is still in flight there, so treat skill
 * rows as a future capability, not a shipped one.
 *
 * Mirrors `Spora\Search\SearchHit::toArray()` field for field.
 */

export interface SearchHit {
  /**
   * Provider-chosen group name (`media-archive` from the media-archive plugin,
   * `skill` from a custom-skills provider once one ships).
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
   * searchable thing, so a provider that cannot name a destination says so
   * rather than inventing a 404. The palette therefore renders a null-`href`
   * hit but never makes it activatable.
   */
  href: string | null
}

/**
 * `{ data: { hits, query } }` with the envelope already stripped — `api.get`
 * unwraps `body.data`, so callers read this shape directly. That unwrapping is
 * also why `CommandPalette` re-validates the body before rendering it: a bare
 * array or `{ data: {} }` reaches the palette looking exactly like this shape.
 */
export interface SearchResponse {
  hits: SearchHit[]
  /**
   * The query the backend actually searched for, after clamping to
   * `SearchController::MAX_QUERY_LENGTH` (200). The palette clamps the needle to
   * the same limit before sending, so in practice this echoes what was sent.
   */
  query: string
}