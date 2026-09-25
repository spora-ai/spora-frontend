<script setup lang="ts">
/**
 * AgentToolsSection — tool registry grouped by category with enable/disable,
 * per-tool configuration, and operation auto-approve toggles.
 *
 * Owns the local state (registry, status map, per-tool saving flags,
 * modal flags, filter state) and the enable/disable + operation override
 * flows. The page provides the agent + agentId.
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
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { categoryLabel, groupToolsByCategory, sortCategoryKeys } from '@/utils/toolCategories'
import { ApiError, api } from '@/api/client'
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
const { confirm } = useConfirmDialog()

const toolRegistry = ref<ToolSchema[]>([])
const toolStatusMap = ref<Record<string, ToolStatus>>({})
const enabledToolNames = ref<Set<string>>(new Set())
const savingTool = ref<Record<string, boolean>>({})
const savingOperation = ref<Record<string, boolean>>({})
const operationStates = ref<Record<string, Record<string, { enabled: boolean; requiresApproval: boolean }>>>({})
const error = ref<string | null>(null)

// Bundled-skill state (PR 2 of `recommendsSkills`). `skillAllowlist` is the
// raw `allowed_skills` value from SkillTool's per-agent override; the
// per-tool enablement map below is derived from it so the list re-renders
// without an extra fetch when the allowlist mutates.
const skillAllowlist = ref<string[]>([])
const bundledSkillsLoading = ref<Record<string, boolean>>({})

const isSkillToolRegistered = computed(() =>
  toolRegistry.value.some((t) => t.tool_name === SKILL_TOOL_NAME),
)

const bundledSkillsByToolName = computed<Record<string, boolean>>(() => {
  const map: Record<string, boolean> = {}
  const skillEnabled = isSkillToolRegistered.value && enabledToolNames.value.has(SKILL_TOOL_NAME)
  const allowed = new Set(skillAllowlist.value)
  for (const tool of toolRegistry.value) {
    if (tool.recommends_skills.length === 0) continue
    map[tool.tool_name] = skillEnabled && tool.recommends_skills.every((s) => allowed.has(s))
  }
  return map
})

const configuringTool = ref<string | null>(null)
const pendingEnableAfterConfig = ref<string | null>(null)

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

  const [toolsResult, allStatuses] = await Promise.all([
    api.get<{ tools: ToolSchema[] }>('/tools'),
    toolSettings.getAllToolStatuses(),
  ])
  toolRegistry.value = toolsResult.tools.map(normalizeToolSchema)
  toolStatusMap.value = allStatuses

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

async function toggleBundledSkills(tool: ToolSchema): Promise<void> {
  bundledSkillsLoading.value[tool.tool_name] = true
  error.value = null
  const wasEnabled = bundledSkillsByToolName.value[tool.tool_name] === true
  try {
    if (wasEnabled) {
      await bundledSkills.removeSkillsFromAllowlist(tool.recommends_skills)
      skillAllowlist.value = skillAllowlist.value.filter((s) => !tool.recommends_skills.includes(s))
      return
    }
    // Toggling on: make sure SkillTool itself is enabled, then add the
    // recommended slugs to its allowlist. enableTool is a no-op when
    // already on (server returns the row), so we don't gate on state.
    if (!enabledToolNames.value.has(SKILL_TOOL_NAME)) {
      await agentStore.enableTool(props.agentId, SKILL_TOOL_NAME)
      enabledToolNames.value.add(SKILL_TOOL_NAME)
      const newStatus = await toolSettings.getToolStatus(SKILL_TOOL_NAME)
      if (newStatus !== null) toolStatusMap.value[SKILL_TOOL_NAME] = newStatus
      await loadOperationOverrides()
    }
    await bundledSkills.addSkillsToAllowlist(tool.recommends_skills)
    await loadBundledSkills()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to update bundled skills.'
    await loadBundledSkills()
  } finally {
    bundledSkillsLoading.value[tool.tool_name] = false
  }
}

async function toggleTool(toolName: string): Promise<void> {
  savingTool.value[toolName] = true
  error.value = null
  try {
    if (enabledToolNames.value.has(toolName)) {
      const tool = toolRegistry.value.find((t) => t.tool_name === toolName)
      const uniqueSlugs = (tool?.recommends_skills ?? []).filter(
        (slug) => !otherToolsAlsoRecommend(slug, toolName),
      )
      if (uniqueSlugs.length > 0) {
        // The disable intent is already explicit (the toggle was clicked);
        // the dialog only asks whether to also clean up the SkillTool
        // allowlist. Cancel / Keep both disable the tool, Remove also
        // strips the unique slugs.
        const removeSlugs = await confirm(
          `Skill tool would lose access to these skills:\n\n${uniqueSlugs.join(', ')}`,
          'Remove bundled skill(s)?',
          'Remove',
          'Keep',
        )
        await agentStore.disableTool(props.agentId, toolName)
        enabledToolNames.value.delete(toolName)
        if (removeSlugs) {
          try {
            await bundledSkills.removeSkillsFromAllowlist(uniqueSlugs)
            await loadBundledSkills()
          } catch (e) {
            error.value = e instanceof ApiError ? e.message : 'Failed to update bundled skills.'
          }
        }
        return
      }
      await agentStore.disableTool(props.agentId, toolName)
      enabledToolNames.value.delete(toolName)
      return
    }
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
        :bundled-skills-enabled="bundledSkillsByToolName[tool.tool_name] === true"
        :bundled-skills-available="isSkillToolRegistered"
        :bundled-skills-loading="bundledSkillsLoading[tool.tool_name] ?? false"
        @toggle="toggleTool(tool.tool_name)"
        @open-config="configuringTool = tool.tool_name"
        @set-up-and-enable="setUpAndEnable(tool.tool_name)"
        @toggle-operation-enabled="(op) => toggleOperationEnabled(tool.tool_name, op)"
        @toggle-operation-auto-approve="(op) => toggleOperationAutoApprove(tool.tool_name, op)"
        @toggle-bundled-skills="toggleBundledSkills(tool)"
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
