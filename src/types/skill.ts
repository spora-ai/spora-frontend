/**
 * Skill discovery + detail shapes returned by spora-core's
 * `SkillController` (`GET /api/v1/skills` and `GET /api/v1/skills/{slug}`).
 *
 * Mirrors the controllers `summarize()` / `detail()` methods (PHP
 * array shapes in `app/Http/SkillController.php`).
 */

/** One sidecar file under a skill directory. */
export interface SkillFile {
  /** Path relative to the skill root, e.g. `references/REFERENCE.md`. */
  path: string
  /** File size in bytes. */
  bytes: number
}

/** Compact summary returned by `GET /api/v1/skills` (powers the `allowed_skills` multi-select). */
export interface SkillSummary {
  name: string
  /** Directory slug — the key the `allowed_skills` setting stores. */
  slug: string
  description: string
  /** `project`, `core`, or a plugin slug. */
  source: string
  license: string | null
  files_count: number
  has_warnings: boolean
  /** Tool names parsed from the frontmatter's `allowed-tools` key. */
  required_tools: string[]
}

/** Full detail returned by `GET /api/v1/skills/{slug}`. */
export interface SkillDetail {
  name: string
  description: string
  license: string | null
  compatibility: string | null
  /** Free-form `map<string,string>` from the frontmatter's `metadata:` key. */
  metadata: Record<string, string>
  /** Spec-experimental; parsed but not enforced. */
  allowed_tools: string | null
  /** `SKILL.md` body with frontmatter stripped. */
  body: string
  body_bytes: number
  files: SkillFile[]
  /** Operator-visible warnings; same shape as SkillValidator / SkillScanner emits. */
  warnings: Array<{ code: string; severity: string; message: string; path?: string }>
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

export interface SkillDetailResponse {
  skill: SkillDetail; source: string
}
