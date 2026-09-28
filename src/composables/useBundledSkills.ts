/**
 * useBundledSkills — read/write the SkillTool's `allowed_skills` allowlist
 * for a given agent.
 *
 * The SkillTool stores `allowed_skills` as a JSON-encoded string in its
 * per-agent override (`PUT /agents/{id}/tools/skill/override`), matching
 * the multi-select field convention (see `ToolSettingField.vue`). Reads
 * JSON-parse the value; writes JSON-stringify it. The composable unions
 * and subtracts slugs on the array level so callers never have to touch
 * the wire shape.
 *
 * Bundling semantics: PR 2 of `recommendsSkills` ties non-SkillTool
 * tools to SkillTool via `recommends_skills`. When the operator enables
 * such a tool, `addSkillsToAllowlist` unions the recommended slugs into
 * SkillTool's allowlist (preserving any slugs the operator added
 * manually). When the operator disables the tool, the
 * `AgentToolsSection` orchestrator decides whether to subtract the
 * unique recommended slugs based on whether another enabled tool also
 * recommends them.
 */
import type { Ref } from 'vue'
import { api } from '@/api/client'

function unionUnique(...lists: string[][]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const item of list) {
      if (typeof item !== 'string' || seen.has(item)) continue
      seen.add(item)
      out.push(item)
    }
  }
  return out
}

export function useBundledSkills(agentId: Ref<string | number>, skillToolName = 'skill') {
  function settingsPath(query = ''): string {
    const base = `/agents/${agentId.value}/tools/${encodeURIComponent(skillToolName)}/override`
    return query === '' ? base : `${base}?${query}`
  }

  async function readEffectiveSkills(): Promise<string[]> {
    // ?raw=true skips the controller's `{value, source}` annotation
    // wrapper and returns the flat `{key: value}` shape that matches
    // the PUT payload — without this flag, `allowed_skills` arrives as
    // `{value: '[...]', source: 'agent'}` and `JSON.parse(raw)` would
    // throw. See AgentOverrideController::getOverride for the routing.
    const result = await api.get<{ settings: Record<string, string> }>(settingsPath('raw=true'))
    const raw = result.settings?.['allowed_skills']
    if (typeof raw !== 'string' || raw === '') return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
    } catch {
      return []
    }
  }

  async function writeAllowlist(next: string[]): Promise<void> {
    await api.put<{ settings: Record<string, string> }>(settingsPath(), {
      settings: { allowed_skills: JSON.stringify(next) },
    })
  }

  async function addSkillsToAllowlist(slugs: string[]): Promise<void> {
    const current = await readEffectiveSkills()
    await writeAllowlist(unionUnique(current, slugs))
  }

  async function removeSkillsFromAllowlist(slugs: string[]): Promise<void> {
    const current = await readEffectiveSkills()
    const removeSet = new Set(slugs)
    await writeAllowlist(current.filter((s) => !removeSet.has(s)))
  }

  return {
    readEffectiveSkills,
    addSkillsToAllowlist,
    removeSkillsFromAllowlist,
  }
}
