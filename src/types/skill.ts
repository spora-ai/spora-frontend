/**
 * Skills API types — mirrors spora-workspace/plans/skills.md and the
 * `app/Http/SkillController.php` summary shape.
 *
 * Skills are versionable, file-backed bundles of operator knowledge
 * surfaced to the agent via the Skill tool (see `src/types/agent.ts` →
 * the tool's `allowed_skills` setting). The frontend renders them in
 * the agent settings form (multi-select via `dataSource`) and shows
 * detail in the operator-facing skills browser.
 */

/** Summary returned by GET /api/v1/skills. */
export interface SkillSummary {
  name: string
  description: string
  source: string | null
  license: string | null
  files_count: number
  has_warnings: boolean
}

/** Single file under a skill directory, as listed by `skill_files` and `GET /api/v1/skills/{slug}`. */
export interface SkillFile {
  path: string
  bytes: number
}

/** Detail returned by GET /api/v1/skills/{slug}. */
export interface SkillDetail {
  name: string
  description: string
  license: string | null
  compatibility: string | null
  metadata: Record<string, string>
  allowed_tools: string | null
  /** SKILL.md body with frontmatter stripped. */
  body: string
  body_bytes: number
  files: SkillFile[]
  warnings: Array<{
    code: string
    severity: string
    message: string
    path?: string
  }>
}

/** Wrapper returned by `GET /api/v1/skills/{slug}`. */
export interface SkillDetailResponse {
  data: {
    skill: SkillDetail
    source: string | null
  }
}

/** Wrapper returned by `GET /api/v1/skills`. */
export interface SkillListResponse {
  data: {
    skills: SkillSummary[]
  }
}
