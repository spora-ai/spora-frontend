<script setup lang="ts">
import { computed } from 'vue'
import Toggle from '@/components/ui/Toggle.vue'
import Icon from '@/components/ui/Icon.vue'
import type { ToolSchema } from '@/composables/useToolSettings'

const props = withDefaults(defineProps<{
  tool: ToolSchema & { operations?: ToolOperationSchema[] }
  enabled: boolean
  saving: boolean
  missingRequired?: string[]
  operationStates?: Record<string, { enabled: boolean; requiresApproval: boolean }>
  /**
   * Whether the tool can be enabled RIGHT NOW without adding a per-agent
   * override. `true` when there are no required settings OR the cascade
   * (global → user → group) already covers them. When `false`, the tool
   * genuinely needs per-agent credentials and the Set up & enable CTA
   * is the right action. Defaults to `true` while the status map is loading.
   */
  canEnable?: boolean
  /**
   * Skill slugs this tool recommends on the SkillTool allowlist (PR 2 of
   * `recommendsSkills`). Drives a per-skill toggle list when non-empty.
   * Order is preserved as declared on the attribute.
   */
  recommendsSkills?: string[]
  /**
   * The slugs that are CURRENTLY active on the SkillTool allowlist for
   * this agent — the intersection of `recommendsSkills` and the
   * effective `allowed_skills` of SkillTool. Drives each row's
   * on/off state. Defaults to an empty set so the parent can ship
   * `recommendsSkills` without the active map during the initial
   * mount fetch.
   */
  enabledSkillSlugs?: string[]
  /**
   * Whether the SkillTool is registered in the tool registry at all.
   * When false, every bundled-skill toggle is disabled with a
   * "Skill not installed" tooltip — the strict-mode 500 from the
   * backend usually keeps this from happening in production, but the
   * UI defends anyway.
   */
  bundledSkillsAvailable?: boolean
  /** Suppresses the affordance while the parent is wiring it up. */
  bundledSkillsLoading?: boolean
}>(), {
  canEnable: true,
  recommendsSkills: () => [] as string[],
  enabledSkillSlugs: () => [] as string[],
  bundledSkillsAvailable: true,
  bundledSkillsLoading: false,
})

const emit = defineEmits<{
  toggle: []
  openConfig: []
  toggleOperationEnabled: [operationName: string]
  toggleOperationAutoApprove: [operationName: string]
  /** Set up the tool's credentials and auto-enable it in one step. */
  setUpAndEnable: []
  /**
   * Toggle a single bundled skill. The parent owns the SkillTool
   * enable state and the per-agent allowlist; the child only signals
   * intent for one slug at a time. `value: true` means the operator
   * wants the slug enabled; `false` means they want it removed.
   */
  toggleBundledSkill: [payload: { slug: string, value: boolean }]
}>()

export interface ToolOperationSchema {
  name: string
  description: string
  operator_description: string
  enabledByDefault: boolean
  requiresApprovalByDefault: boolean
}

const hasSchema = computed(() => props.tool.settings_schema.length > 0)
const needsConfigWarning = computed(
  () => props.enabled && (props.missingRequired?.length ?? 0) > 0,
)
/**
 * Disabled with credentials to configure — the toggle would be a no-op.
 * Only true when the cascade (global/user/group) has no defaults and the
 * tool genuinely needs a per-agent override. If defaults exist anywhere,
 * `canEnable` is true and the operator should just flip the toggle.
 */
const disabledNeedsConfig = computed(
  () => !props.enabled && hasSchema.value && props.canEnable === false,
)
const hasOperations = computed(() => (props.tool.operations?.length ?? 0) > 0)
const showNoDescriptionFallback = computed(
  () => !props.tool.description && !hasSchema.value,
)
const hasBundledSkills = computed(() => props.recommendsSkills.length > 0)
const enabledSkillSet = computed(() => new Set(props.enabledSkillSlugs))
function isSkillEnabled(slug: string): boolean {
  return enabledSkillSet.value.has(slug)
}

/**
 * `media-library` → `Media Library`. SkillTool's `name` field in the
 * agentskills.io frontmatter equals the directory slug, so this is the
 * canonical display name until the wire carries a richer label.
 */
function formatSkillName(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
</script>

<template>
  <div class="px-5 py-4 flex flex-col gap-3">
    <div class="flex items-start gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <p class="text-sm font-medium">
            {{ tool.display_name || tool.tool_name }}
          </p>
          <span
            v-if="needsConfigWarning"
            class="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400"
            title="Missing required settings"
          >
            <Icon
              name="warning"
              class="h-3 w-3"
            />
            Missing config
          </span>
        </div>
        <p
          v-if="tool.description"
          class="text-xs text-muted-foreground mt-0.5 line-clamp-2"
        >
          {{ tool.description }}
        </p>
        <p
          v-else-if="hasSchema"
          class="text-xs mt-0.5"
          :class="enabled ? 'text-muted-foreground' : 'text-muted-foreground/50'"
        >
          {{ enabled ? 'Has credentials to configure' : 'Enable to configure credentials' }}
        </p>
        <p
          v-else-if="showNoDescriptionFallback"
          class="text-xs mt-0.5 italic text-muted-foreground/60"
          data-testid="no-description-fallback"
        >
          No description provided by this tool.
        </p>
        <p
          v-if="needsConfigWarning"
          class="text-xs mt-0.5 text-amber-600 dark:text-amber-400"
        >
          This tool may not work until required settings are configured.
        </p>
      </div>
      <div class="flex items-center gap-3 shrink-0">
        <button
          v-if="enabled && hasSchema"
          type="button"
          data-testid="configure"
          class="inline-flex h-7 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          @click="emit('openConfig')"
        >
          Configure
        </button>
        <button
          v-if="disabledNeedsConfig"
          type="button"
          data-testid="set-up-and-enable"
          class="inline-flex h-7 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
          @click="emit('setUpAndEnable')"
        >
          <Icon
            name="plus"
            class="mr-1 h-3 w-3"
          />
          Set up &amp; enable
        </button>
        <Toggle
          v-if="!disabledNeedsConfig"
          :model-value="enabled"
          :disabled="saving"
          @update:model-value="emit('toggle')"
        />
      </div>
    </div>

    <div
      v-if="hasOperations && enabled"
      class="flex flex-col divide-y divide-border/50 border border-border/50 rounded-lg overflow-hidden"
    >
      <div
        v-for="op in tool.operations"
        :key="op.name"
        class="flex items-start gap-3 pl-4 pr-5 py-3 bg-muted/10"
      >
        <div class="flex items-center shrink-0">
          <Toggle
            size="sm"
            :model-value="operationStates?.[op.name]?.enabled ?? op.enabledByDefault"
            :disabled="saving"
            @update:model-value="emit('toggleOperationEnabled', op.name)"
          />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="text-xs font-medium font-mono text-zinc-700 dark:text-zinc-300">
              {{ op.name }}
            </p>
            <span
              class="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              :class="(operationStates?.[op.name]?.requiresApproval ?? op.requiresApprovalByDefault) === false
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'"
            >
              <Icon
                v-if="(operationStates?.[op.name]?.requiresApproval ?? op.requiresApprovalByDefault) === false"
                name="eye"
                class="h-3 w-3"
              />
              <Icon
                v-else
                name="lock"
                class="h-3 w-3"
              />
              {{ (operationStates?.[op.name]?.requiresApproval ?? op.requiresApprovalByDefault) === false ? 'Auto-approve' : 'Requires approval' }}
            </span>
          </div>
          <p class="text-xs text-muted-foreground mt-0.5">
            {{ op.operator_description || op.description }}
          </p>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <span class="text-[11px] text-muted-foreground">Auto-approve</span>
          <Toggle
            size="sm"
            :model-value="(operationStates?.[op.name]?.requiresApproval ?? op.requiresApprovalByDefault) === false"
            :disabled="saving || !(operationStates?.[op.name]?.enabled ?? op.enabledByDefault)"
            @update:model-value="emit('toggleOperationAutoApprove', op.name)"
          />
        </div>
      </div>
    </div>

    <!-- Bundled-skill affordance (PR 2 of `recommendsSkills`). Hidden
         when the tool doesn't recommend any skills OR when the tool is
         itself disabled — bundled skills only make sense while the
         parent tool is on, and enabling a skill on an inactive tool
         was a confusing surface area.

         Each recommended slug gets its own row mirroring the operation
         toggle pattern (icon + label on the left, Toggle switch on the
         right). The visible name is the slug title-cased (`media-library`
         → `Media Library`) and the raw slug renders in a mono font
         underneath so operators can copy it.

         Per-skill OFF only removes that one slug from SkillTool's
         allowlist; SkillTool stays enabled (other bundled skills from
         this or sibling tools may still depend on it).

         Disabling the parent tool silently strips the unique slugs
         from SkillTool's allowlist. SkillTool itself stays enabled —
         the operator manages it via its own card or the per-skill
         toggles. Shared slugs (also recommended by another tool) are
         kept: the sibling tool still owns them. -->
    <div
      v-if="hasBundledSkills && enabled"
      class="space-y-1.5 pt-1"
      data-testid="bundled-skill-list"
    >
      <div class="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon
          name="sparkles"
          class="h-3 w-3 text-amber-500 dark:text-amber-400"
        />
        Recommended skills
      </div>
      <div
        v-for="slug in recommendsSkills"
        :key="slug"
        class="flex items-center justify-between gap-2"
        :data-testid="`bundled-skill-row-${slug}`"
      >
        <div class="min-w-0">
          <p class="text-xs font-medium truncate">
            {{ formatSkillName(slug) }}
          </p>
          <p class="text-[11px] font-mono text-muted-foreground truncate">
            {{ slug }}
          </p>
        </div>
        <Toggle
          size="sm"
          :model-value="isSkillEnabled(slug)"
          :disabled="!bundledSkillsAvailable || bundledSkillsLoading || saving"
          :title="!bundledSkillsAvailable
            ? 'Skill not installed'
            : isSkillEnabled(slug)
              ? `Remove ${slug} from Skill tool allowlist`
              : `Add ${slug} to Skill tool allowlist (and enable Skill tool)`"
          @update:model-value="(value) => emit('toggleBundledSkill', { slug, value })"
        />
      </div>
    </div>
  </div>
</template>
