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
  description: string
  /** `project`, `core`, or a plugin slug. */
  source: string
  license: string | null
  files_count: number
  has_warnings: boolean
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

export interface SkillListResponse {
  data: { skills: SkillSummary[] }
}

export interface SkillDetailResponse {
  data: { skill: SkillDetail; source: string }
}
