<script setup lang="ts">
/**
 * AgentToolsSection — tool registry grouped by category with enable/disable,
 * per-tool configuration, and operation auto-approve toggles.
 *
 * Owns the local state (registry, status map, per-tool saving flags,
 * modal flags, filter state) and the enable/disable + operation override
 * flows, plus the banner reporting tools the agent's skills declare but
 * that are not ready here. The page provides the agent + agentId.
 *
 * Configure flow contract:
 *   When the user clicks "Set up & enable" on a disabled-needs-config
 *   tool, `pendingEnableAfterConfig` is set to that tool's name BEFORE
 *   opening the config modal. `onToolSaved` checks this ref: if set and
 *   matching the saved tool, it refreshes status, calls `enableTool`,
 *   refreshes status again (to pick up the `is_enabled` flag the
 *   backend flipped), adds the tool to `enabledToolNames` if enabled,
 *   then reloads the per-operation overrides. When the ref is null
 *   (regular re-edit of an enabled tool), `onToolSaved` only refreshes
 *   status — no enable call. The flag is intentionally NOT cleared on
 *   modal close: `AgentToolConfigModal` emits `saved` and `close` in
 *   the same tick, so clearing here would race `onToolSaved`'s async
 *   path and silently skip the auto-enable.
 */
import { ref, computed, onMounted, type Ref } from 'vue'
import { useAgentStore } from '@/stores/agent'
import { useToolSettings, type ToolSchema, type ToolStatus, normalizeToolSchema } from '@/composables/useToolSettings'
import { useBundledSkills } from '@/composables/useBundledSkills'
import { categoryLabel, groupToolsByCategory, sortCategoryKeys } from '@/utils/toolCategories'
import { ApiError, api } from '@/api/client'
import { Icon } from '@spora-ai/components/icons'
import Toggle from '@/components/ui/Toggle.vue'
import type { SkillListResponse, SkillSummary } from '@/types/skill'
import AgentToolListItem from '@/components/agent/AgentToolListItem.vue'
import AgentToolConfigModal from '@/components/agent/AgentToolConfigModal.vue'
import AgentToolsToolbar, {
  type CategoryOption,
  type StatusFilter,
} from '@/components/agent/settings/AgentToolsToolbar.vue'

const SKILL_TOOL_NAME = 'skill'

interface Agent {
  id: number
  tools: Array<{ tool_name: string }>
  principal_id?: number | null
}

const props = defineProps<{
  agent: Agent
  agentId: number
}>()

const agentStore = useAgentStore()
const toolSettings = useToolSettings(props.agentId)
const agentIdRef: Ref<number> = computed(() => props.agentId)
const bundledSkills = useBundledSkills(agentIdRef, SKILL_TOOL_NAME)

const toolRegistry = ref<ToolSchema[]>([])
const toolStatusMap = ref<Record<string, ToolStatus>>({})
const enabledToolNames = ref<Set<string>>(new Set())
const savingTool = ref<Record<string, boolean>>({})
const savingOperation = ref<Record<string, boolean>>({})
const operationStates = ref<Record<string, Record<string, { enabled: boolean; requiresApproval: boolean }>>>({})
const error = ref<string | null>(null)

// Bundled-skill state (PR 2 of `recommendsSkills`). `skillAllowlist` is the
// raw `allowed_skills` value from SkillTool's per-agent override; the
// per-tool enablement sets below are derived from it so each row's Toggle
// re-renders without an extra fetch when the allowlist mutates.
const skillAllowlist = ref<string[]>([])
const bundledSkillsLoading = ref<Record<string, boolean>>({})
// `required_tools` of every skill the instance has, joined against the
// allowlist above to drive the declared-tools banner.
const skillSummaries = ref<SkillSummary[]>([])

const isSkillToolRegistered = computed(() =>
  toolRegistry.value.some((t) => t.tool_name === SKILL_TOOL_NAME),
)

const skillToolIsEnabled = computed(
  () => isSkillToolRegistered.value && enabledToolNames.value.has(SKILL_TOOL_NAME),
)

/**
 * Slugs currently on SkillTool's allowlist for THIS agent. The
 * per-tool list (`enabledSkillSlugs`) is the intersection of this set
 * with each tool's `recommends_skills` so the row only shows slugs
 * that ARE bundled (not every skill the operator has allowlisted
 * globally).
 */
const enabledSkillSlugsByToolName = computed<Record<string, string[]>>(() => {
  const map: Record<string, string[]> = {}
  if (!skillToolIsEnabled.value) return map
  const allowed = new Set(skillAllowlist.value)
  for (const tool of toolRegistry.value) {
    if (tool.recommends_skills.length === 0) continue
    const intersection = tool.recommends_skills.filter((s) => allowed.has(s))
    if (intersection.length > 0) map[tool.tool_name] = intersection
  }
  return map
})

const configuringTool = ref<string | null>(null)
const pendingEnableAfterConfig = ref<string | null>(null)

type DeclaredToolState = 'not-activated' | 'unconfigured' | 'unavailable'

// Row subtitles. Phrased as facts about the agent, never as obligations:
// a declaration is not a grant, and a missing plugin is not a mistake.
const DECLARED_TOOL_NOTES: Record<DeclaredToolState, string> = {
  'not-activated': 'Not on this agent',
  'unconfigured': 'On, but its settings are not set up',
  'unavailable': 'Plugin not installed',
}

interface DeclaredToolGap {
  toolName: string
  displayName: string
  state: DeclaredToolState
}

/**
 * One row for a tool a skill declares. `null` when the tool is ready to
 * run, which is the common case and renders nothing.
 */
function declaredToolGap(tool: ToolSchema | undefined, toolName: string): DeclaredToolGap | null {
  // No registry entry means no plugin provides the tool on this instance.
  if (!tool) return { toolName, displayName: toolName, state: 'unavailable' }
  const displayName = tool.display_name || toolName
  const status = toolStatusMap.value[toolName]
  // `getAllToolStatuses` swallows its own failures and returns `{}`, so a
  // missing entry is not proof the tool is off — check the agent's own
  // tool list before telling the operator to enable something.
  const isEnabled = status?.is_enabled ?? enabledToolNames.value.has(toolName)
  if (!isEnabled) return { toolName, displayName, state: 'not-activated' }
  // On, yet the cascade leaves required settings unset (`can_enable` is
  // false). The tool still cannot run and enabling it again changes
  // nothing, so this row configures instead of toggling.
  if (status?.can_enable === false) return { toolName, displayName, state: 'unconfigured' }
  return null
}

/**
 * Tools the skills enabled on this agent declare using, minus the ones
 * already ready to run. A declaration is not a grant — Spora
 * pre-approves nothing and refuses no call on a skill's behalf — so this
 * informs and stays empty (no banner) when the agent is already covered.
 */
const declaredToolGaps = computed<DeclaredToolGap[]>(() => {
  const enabledSlugs = new Set(skillAllowlist.value)
  if (enabledSlugs.size === 0) return []
  const gaps: DeclaredToolGap[] = []
  const seen = new Set<string>()
  for (const skill of skillSummaries.value) {
    if (!enabledSlugs.has(skill.slug)) continue
    // `required_tools` is newer than this frontend; a core that predates
    // it omits the field rather than sending an empty list.
    if (!skill.required_tools?.length) continue
    for (const toolName of skill.required_tools) {
      if (seen.has(toolName)) continue
      seen.add(toolName)
      const gap = declaredToolGap(
        toolRegistry.value.find((t) => t.tool_name === toolName),
        toolName,
      )
      if (gap !== null) gaps.push(gap)
    }
  }
  return gaps
})

/**
 * The warning's heading, counted.
 *
 * The count is the point of it: "Tools these skills use" read the same whether
 * one tool or nine were missing, so an operator could not tell a small nudge
 * from a genuinely incomplete toolset without counting rows by hand.
 */
const declaredToolHeading = computed<string>(() => {
  const n = declaredToolGaps.value.length
  return n === 1
    ? '1 tool these skills use is not ready on this agent'
    : `${n} tools these skills use are not ready on this agent`
})

const searchQuery = ref('')
const statusFilter = ref<StatusFilter>('all')
const categoryFilter = ref<Set<string>>(new Set())

const toolsByCategory = computed(() => groupToolsByCategory(toolRegistry.value))
const sortedCategories = computed(() => sortCategoryKeys(toolsByCategory.value))

function matchesSearch(tool: ToolSchema, query: string): boolean {
  if (query.length === 0) return true
  const haystacks = [
    tool.display_name ?? '',
    tool.tool_name ?? '',
    tool.description ?? '',
    ...(tool.operations?.map((o) => o.name ?? '') ?? []),
    ...(tool.operations?.map((o) => o.description ?? '') ?? []),
  ]
  const needle = query.toLowerCase()
  return haystacks.some((h) => String(h).toLowerCase().includes(needle))
}

function toolStatusKind(tool: ToolSchema): 'enabled' | 'needs-setup' | 'off' {
  const status = toolStatusMap.value[tool.tool_name]
  const missing = status?.missing_required ?? []
  const canEnable = status?.can_enable ?? true

  if (enabledToolNames.value.has(tool.tool_name)) {
    return missing.length > 0 ? 'needs-setup' : 'enabled'
  }
  // Disabled but the cascade has no defaults — the operator must add
  // per-agent credentials via the Set up & enable CTA. Same shape as
  // an enabled tool with missing_required: it cannot work without action.
  if (!canEnable && tool.settings_schema.length > 0) {
    return 'needs-setup'
  }
  return 'off'
}

const statusCounts = computed(() => {
  let enabled = 0
  let needsSetup = 0
  let off = 0
  for (const tool of toolRegistry.value) {
    const kind = toolStatusKind(tool)
    if (kind === 'enabled') enabled++
    else if (kind === 'needs-setup') needsSetup++
    else off++
  }
  return { all: toolRegistry.value.length, enabled, needsSetup, off }
})

const filteredTools = computed<ToolSchema[]>(() => {
  const query = searchQuery.value.trim()
  const filteredStatus = statusFilter.value
  const allowedCats = categoryFilter.value

  return toolRegistry.value.filter((tool) => {
    if (allowedCats.size > 0 && !allowedCats.has(tool.category ?? 'general')) {
      return false
    }
    if (filteredStatus !== 'all' && toolStatusKind(tool) !== filteredStatus) {
      return false
    }
    return matchesSearch(tool, query)
  })
})

const filteredToolsByCategory = computed(() => groupToolsByCategory(filteredTools.value))
const filteredSortedCategories = computed(() =>
  sortCategoryKeys(filteredToolsByCategory.value),
)

const categoriesForToolbar = computed<CategoryOption[]>(() => {
  const groups = toolsByCategory.value
  return sortedCategories.value.map((key) => ({
    key,
    label: categoryLabel(key),
    count: groups[key].length,
  }))
})

function configuringToolSchema(): ToolSchema | null {
  return toolRegistry.value.find((t) => t.tool_name === configuringTool.value) ?? null
}

onMounted(async () => {
  enabledToolNames.value = new Set(props.agent.tools.map((t) => t.tool_name))

  const [toolsResult, allStatuses, skillsResult] = await Promise.all([
    api.get<{ tools: ToolSchema[] }>('/tools'),
    toolSettings.getAllToolStatuses(),
    // Advisory only — the banner is optional information, so a failing
    // skills lookup must not take the tool list down with it.
    api.get<Partial<SkillListResponse>>('/skills').catch(() => null),
  ])
  toolRegistry.value = toolsResult.tools.map(normalizeToolSchema)
  toolStatusMap.value = allStatuses
  // Unwrapped: `api/client.ts` already strips core's `{data: …}` envelope, so
  // reading `.data.skills` here yielded undefined and left this permanently
  // empty — which is why the declared-tools banner never rendered.
  skillSummaries.value = skillsResult?.skills ?? []

  for (const tool of props.agent.tools) {
    const status = allStatuses[tool.tool_name]
    if (status) {
      if (status.is_enabled) enabledToolNames.value.add(tool.tool_name)
      else enabledToolNames.value.delete(tool.tool_name)
    }
  }
  await loadOperationOverrides()
  await loadBundledSkills()
})

async function loadOperationOverrides(): Promise<void> {
  operationStates.value = await agentStore.getAllOperationOverrides(props.agentId)
}

async function loadBundledSkills(): Promise<void> {
  if (!isSkillToolRegistered.value || !enabledToolNames.value.has(SKILL_TOOL_NAME)) {
    skillAllowlist.value = []
    return
  }
  try {
    skillAllowlist.value = await bundledSkills.readEffectiveSkills()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to load Skill tool allowlist.'
    skillAllowlist.value = []
  }
}

function otherToolsAlsoRecommend(slug: string, excludingToolName: string): boolean {
  return toolRegistry.value.some((t) =>
    t.tool_name !== excludingToolName && t.recommends_skills.includes(slug),
  )
}

async function toggleBundledSkill(
  tool: ToolSchema,
  slug: string,
  value: boolean,
): Promise<void> {
  bundledSkillsLoading.value[tool.tool_name] = true
  error.value = null
  try {
    if (value) {
      // Toggle ON: ensure SkillTool is enabled (no-op if already on)
      // then add the slug. SkillTool stays on even if the operator
      // later toggles this one off — other tools / operators may
      // still need it.
      if (!enabledToolNames.value.has(SKILL_TOOL_NAME)) {
        await agentStore.enableTool(props.agentId, SKILL_TOOL_NAME)
        enabledToolNames.value.add(SKILL_TOOL_NAME)
        const newStatus = await toolSettings.getToolStatus(SKILL_TOOL_NAME)
        if (newStatus !== null) toolStatusMap.value[SKILL_TOOL_NAME] = newStatus
        await loadOperationOverrides()
      }
      await bundledSkills.addSkillsToAllowlist([slug])
      await loadBundledSkills()
      // Re-fetch SkillTool's status so its card stops showing the
      // "Missing config / has credentials to configure" badge — the
      // per-agent override we just wrote covers the required
      // `allowed_skills` setting, so `missing_required` and
      // `can_enable` now reflect a satisfied cascade.
      const refreshedSkillStatus = await toolSettings.getToolStatus(SKILL_TOOL_NAME)
      if (refreshedSkillStatus !== null) toolStatusMap.value[SKILL_TOOL_NAME] = refreshedSkillStatus
      return
    }
    // Toggle OFF: remove just this slug. SkillTool stays enabled —
    // other bundled skills (including the other ones this same tool
    // recommends, or skills from sibling tools) may still need it.
    // The parent-tool disable path takes care of cascading a full
    // SkillTool disable when the operator actually wants to drop
    // everything.
    await bundledSkills.removeSkillsFromAllowlist([slug])
    await loadBundledSkills()
    // Re-fetch SkillTool's status so its card reflects the new
    // allowlist (e.g. switches to "Missing config" if the operator
    // toggled off the last slug). Without this, the card would show
    // the pre-toggle status until the next full page reload.
    const refreshedSkillStatus = await toolSettings.getToolStatus(SKILL_TOOL_NAME)
    if (refreshedSkillStatus !== null) toolStatusMap.value[SKILL_TOOL_NAME] = refreshedSkillStatus
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to update bundled skills.'
    await loadBundledSkills()
  } finally {
    bundledSkillsLoading.value[tool.tool_name] = false
  }
}

async function disableToolBranch(toolName: string): Promise<void> {
  const tool = toolRegistry.value.find((t) => t.tool_name === toolName)
  const uniqueSlugs = (tool?.recommends_skills ?? []).filter(
    (slug) => !otherToolsAlsoRecommend(slug, toolName),
  )
  // Disabling the parent tool strips its unique recommended slugs
  // from SkillTool's allowlist (shared slugs are kept — the other
  // tool that still owns them might be on). SkillTool itself
  // stays enabled: it's a shared resource, the operator manages
  // it via its own card / per-skill toggles, and we'd rather
  // leave it on (empty allowlist is a valid "ready" state) than
  // guess at the operator's intent. The per-tool bundled-skill
  // row hides once the parent is off, so the cleanup is silent.
  await agentStore.disableTool(props.agentId, toolName)
  enabledToolNames.value.delete(toolName)
  if (uniqueSlugs.length === 0) return
  try {
    await bundledSkills.removeSkillsFromAllowlist(uniqueSlugs)
    await loadBundledSkills()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to update bundled skills.'
  }
  // Reflect the new allowlist state in the SkillTool card so the
  // operator sees the missing-required badge immediately if the
  // unique slugs were the only ones.
  const refreshedSkillStatus = await toolSettings.getToolStatus(SKILL_TOOL_NAME)
  if (refreshedSkillStatus !== null) toolStatusMap.value[SKILL_TOOL_NAME] = refreshedSkillStatus
}

async function enableToolBranch(toolName: string): Promise<void> {
  const status = toolStatusMap.value[toolName]
  if (status && !status.can_enable) {
    pendingEnableAfterConfig.value = toolName
    configuringTool.value = toolName
    return
  }
  await agentStore.enableTool(props.agentId, toolName)
  const newStatus = await toolSettings.getToolStatus(toolName)
  if (newStatus === null || !newStatus.can_enable) {
    if (newStatus !== null) toolStatusMap.value[toolName] = newStatus
    pendingEnableAfterConfig.value = toolName
    configuringTool.value = toolName
    return
  }
  enabledToolNames.value.add(toolName)
  toolStatusMap.value[toolName] = newStatus
  await loadOperationOverrides()
}

async function toggleTool(toolName: string): Promise<void> {
  savingTool.value[toolName] = true
  error.value = null
  try {
    if (enabledToolNames.value.has(toolName)) {
      await disableToolBranch(toolName)
    } else {
      await enableToolBranch(toolName)
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to update tool.'
  } finally {
    savingTool.value[toolName] = false
  }
}

function setUpAndEnable(toolName: string): void {
  pendingEnableAfterConfig.value = toolName
  configuringTool.value = toolName
}

async function toggleOperationEnabled(toolName: string, operationName: string): Promise<void> {
  savingOperation.value[toolName] = true
  error.value = null
  const prev = operationStates.value[toolName]?.[operationName]
  try {
    const newEnabled = !prev?.enabled
    await agentStore.patchOperationOverride(props.agentId, toolName, operationName, { enabled: newEnabled })
    if (!operationStates.value[toolName]) {
      operationStates.value[toolName] = {}
    }
    operationStates.value[toolName][operationName] = {
      enabled: newEnabled,
      requiresApproval: prev?.requiresApproval ?? true,
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to update operation.'
    if (operationStates.value[toolName]?.[operationName]) {
      operationStates.value[toolName][operationName] = prev
    }
  } finally {
    savingOperation.value[toolName] = false
  }
}

async function toggleOperationAutoApprove(toolName: string, operationName: string): Promise<void> {
  savingOperation.value[toolName] = true
  error.value = null
  const prev = operationStates.value[toolName]?.[operationName]
  try {
    const currentRequiresApproval = prev?.requiresApproval ?? true
    const newRequiresApproval = !currentRequiresApproval
    await agentStore.patchOperationOverride(props.agentId, toolName, operationName, {
      default_requires_approval: newRequiresApproval,
    })
    if (!operationStates.value[toolName]) {
      operationStates.value[toolName] = {}
    }
    operationStates.value[toolName][operationName] = {
      enabled: prev?.enabled ?? true,
      requiresApproval: newRequiresApproval,
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to update operation auto-approve.'
    if (operationStates.value[toolName]?.[operationName]) {
      operationStates.value[toolName][operationName] = prev
    }
  } finally {
    savingOperation.value[toolName] = false
  }
}

async function onToolSaved(toolName: string): Promise<void> {
  const newStatus = await toolSettings.getToolStatus(toolName)
  if (newStatus !== null) {
    toolStatusMap.value[toolName] = newStatus
  }
  if (pendingEnableAfterConfig.value !== toolName) return
  pendingEnableAfterConfig.value = null
  if (enabledToolNames.value.has(toolName)) return
  try {
    await agentStore.enableTool(props.agentId, toolName)
    const refreshed = await toolSettings.getToolStatus(toolName)
    if (refreshed !== null) {
      toolStatusMap.value[toolName] = refreshed
      if (refreshed.is_enabled) enabledToolNames.value.add(toolName)
    }
    await loadOperationOverrides()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to enable tool after configuration.'
  }
}
</script>

<template>
  <section class="rounded-xl border border-border bg-card divide-y divide-border">
    <!-- Tools that the skills enabled on this agent declare using but
         that are not ready to run here — the mirror image of a tool's
         "Recommended skills" row. `allowed-tools` is a declaration, not
         a grant: Spora pre-approves nothing and blocks no call on a
         skill's behalf, so this only reports what the skill expects to
         find. "Plugin not installed" describes a missing plugin, not an
         error to fix.

         A tool that is on but missing required settings gets the same
         Set up affordance as its own row; an enable toggle there would
         be a no-op. -->
    <div
      v-if="declaredToolGaps.length > 0"
      class="m-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30"
      role="status"
      data-testid="skill-declared-tools"
    >
      <div class="flex items-start gap-3">
        <!--
        `data-test` rather than asserting on the icon: `Icon.vue` renders only a
        merged path and does not expose `name`, so the path data would be the
        only handle on *which* icon this is — and a brittle one. Vue falls the
        attribute through to the component's single root `<svg>`, which gives a
        stable hook that says "a warning glyph is here" without pinning its
        geometry.
        -->
        <Icon
          name="warning"
          class="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
          data-test="skill-declared-tools-warning-icon"
        />
        <div class="min-w-0 flex-1">
          <!--
          A heading and a sentence, not a caption. The previous version rendered
          a muted 11px label ("Tools these skills use") above a list of tool
          names, which read as metadata rather than as something to act on — an
          operator could not tell it was a problem, what it wanted, or whether it
          mattered.

          The reassurance belongs *inside* the warning, not above it.
          `allowed-tools` is a declaration, not a grant: nothing is blocked and
          no agent is broken. Without that sentence an amber box reads as
          breakage; with it, amber reads as "worth a look".
          -->
          <p class="text-sm font-semibold text-amber-800 dark:text-amber-200">
            {{ declaredToolHeading }}
          </p>
          <p class="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
            Skills you activated call these, but they are not ready here. Turn them on below, or
            from the tool list further down. Nothing is blocked — a skill only declares what it
            expects to use.
          </p>

          <ul class="mt-3 space-y-1.5">
            <li
              v-for="gap in declaredToolGaps"
              :key="gap.toolName"
              class="flex items-center justify-between gap-2 rounded-lg border border-amber-200/70 bg-background/70 px-3 py-1.5 dark:border-amber-800/70 dark:bg-background/40"
              :data-testid="`skill-declared-tool-row-${gap.toolName}`"
            >
              <div class="min-w-0">
                <p class="truncate text-xs font-medium text-foreground">
                  {{ gap.displayName }}
                </p>
                <p class="truncate text-[11px] text-muted-foreground">
                  {{ DECLARED_TOOL_NOTES[gap.state] }}
                </p>
              </div>
              <Toggle
                v-if="gap.state === 'not-activated'"
                size="sm"
                :model-value="false"
                :disabled="savingTool[gap.toolName] ?? false"
                :title="`Enable ${gap.displayName} on this agent`"
                data-testid="skill-declared-tool-enable"
                @update:model-value="() => toggleTool(gap.toolName)"
              />
              <button
                v-else-if="gap.state === 'unconfigured'"
                type="button"
                data-testid="skill-declared-tool-setup"
                class="inline-flex h-7 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
                :title="`Set up ${gap.displayName}, which is on but still missing settings`"
                @click="setUpAndEnable(gap.toolName)"
              >
                <Icon
                  name="plus"
                  class="mr-1 h-3 w-3"
                />
                Set up
              </button>
              <Toggle
                v-else
                size="sm"
                :model-value="false"
                disabled
                :title="`The plugin that provides ${gap.displayName} is not installed`"
                data-testid="skill-declared-tool-unavailable"
              />
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div class="px-5 py-4 flex flex-col gap-3">
      <h2 class="text-base font-semibold">
        Tools
      </h2>
      <AgentToolsToolbar
        v-model:search="searchQuery"
        v-model:status="statusFilter"
        v-model:selected="categoryFilter"
        :categories="categoriesForToolbar"
        :status-counts="statusCounts"
      />
    </div>

    <template
      v-for="cat in filteredSortedCategories"
      :key="cat"
    >
      <div class="px-5 py-2 flex items-center justify-between bg-muted/30">
        <h3 class="text-sm font-medium">
          {{ categoryLabel(cat) }}
        </h3>
        <span class="text-xs text-muted-foreground">{{ filteredToolsByCategory[cat].length }}</span>
      </div>
      <AgentToolListItem
        v-for="tool in filteredToolsByCategory[cat]"
        :key="tool.tool_name"
        :tool="tool"
        :enabled="enabledToolNames.has(tool.tool_name)"
        :saving="savingTool[tool.tool_name] ?? false"
        :missing-required="toolStatusMap[tool.tool_name]?.missing_required ?? []"
        :can-enable="toolStatusMap[tool.tool_name]?.can_enable ?? true"
        :operation-states="operationStates[tool.tool_name]"
        :recommends-skills="tool.recommends_skills"
        :enabled-skill-slugs="enabledSkillSlugsByToolName[tool.tool_name] ?? []"
        :bundled-skills-available="isSkillToolRegistered"
        :bundled-skills-loading="bundledSkillsLoading[tool.tool_name] ?? false"
        @toggle="toggleTool(tool.tool_name)"
        @open-config="configuringTool = tool.tool_name"
        @set-up-and-enable="setUpAndEnable(tool.tool_name)"
        @toggle-operation-enabled="(op) => toggleOperationEnabled(tool.tool_name, op)"
        @toggle-operation-auto-approve="(op) => toggleOperationAutoApprove(tool.tool_name, op)"
        @toggle-bundled-skill="(payload) => toggleBundledSkill(tool, payload.slug, payload.value)"
      />
    </template>

    <div
      v-if="toolRegistry.length === 0"
      class="px-5 py-4 text-sm text-muted-foreground"
    >
      No tools registered.
    </div>
    <div
      v-else-if="filteredTools.length === 0"
      class="px-5 py-6 text-sm text-muted-foreground text-center"
      data-testid="no-results"
    >
      No tools match the current filters.
    </div>
    <div
      v-else
      class="px-5 py-3 text-xs text-muted-foreground"
      data-testid="result-count"
    >
      Showing {{ filteredTools.length }} of {{ toolRegistry.length }}
    </div>
    <p
      v-if="error"
      role="alert"
      data-testid="tools-error"
      class="px-5 py-3 text-xs text-destructive"
    >
      {{ error }}
    </p>

    <AgentToolConfigModal
      :tool-name="configuringTool"
      :tool="configuringToolSchema()"
      :agent-id="agentId"
      :principal-id="props.agent.principal_id"
      @saved="onToolSaved"
      @close="configuringTool = null"
    />
  </section>
</template>
