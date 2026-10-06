/**
 * Skill discovery shapes returned by spora-core's `SkillController`
 * (`GET /api/v1/skills`).
 *
 * Mirrors the controller's `summarize()` method (the PHP array shape in
 * `app/Http/SkillController.php`, straight off `app/Skills/SkillSummary.php`).
 * The `show()` / `detail()` route is deliberately not mirrored here: nothing
 * in the SPA reads `GET /api/v1/skills/{slug}` — the `allowed_skills`
 * multi-select works off the listing, and a body per skill would be tens of
 * kilobytes per dropdown row — so a declared detail shape would only rot out
 * of sync with the controller.
 */

/** Compact summary returned by `GET /api/v1/skills` (powers the `allowed_skills` multi-select). */
export interface SkillSummary {
  name: string
  /**
   * Directory slug — the key the `allowed_skills` setting stores.
   *
   * Nullable because core declares it so (`SkillSummary::__construct` takes
   * `?string $slug = null` for providers that never parse the frontmatter) and
   * `summarize()` passes it straight through. A summary with no slug can never
   * match an allowlist entry, so consumers must treat null as "not selectable".
   */
  slug: string | null
  description: string
  /** `project`, `core`, or a plugin slug; null for a provider that reports no source. */
  source: string | null
  license: string | null
  files_count: number
  has_warnings: boolean
  /** Tool names parsed from the frontmatter's `allowed-tools` key. */
  required_tools: string[]
}

/**
 * `GET /api/v1/skills` as the SPA sees it — already unwrapped.
 *
 * Core answers with the standard `{data: …}` envelope and `api/client.ts`
 * strips it (`body.data ?? body`), so a caller gets the inner object. These
 * types used to carry the envelope a second time, which agreed with the
 * consumer that read `.data.skills` and disagreed with the client that removed
 * it — so TypeScript passed, the mocks passed, and the declared-tools banner
 * rendered nothing in the browser. Unwrap once, in one place.
 */
export interface SkillListResponse {
  skills: SkillSummary[]
}
