<script setup lang="ts">
/**
 * GroupOverviewPage — 4 stat cards + a snapshot of the group's agents.
 *
 * The agent snapshot mirrors the dashboard treatment: each group agent
 * is rendered as a `DashboardAgentCard` (avatar, status pills, recent
 * chats, scheduled chip, kebab menu). Cards are capped at 6; the rest
 * are reachable via "View all" on /groups/:id/agents.
 *
 * Two-up layout: the GroupLayout sidebar (200px on lg+) shaves enough
 * horizontal room that 3-col grid forces ~290px cards — too cramped
 * for the rich DashboardAgentCard. Two columns keeps each card at
 * a comfortable width even on a 1440px viewport. One column on small
 * screens where the cards would otherwise wrap.
 *
 * Data flow: `useDashboardData()` shares its agent+task stores with
 * the dashboard. We scope to the group's principal by filtering the
 * shared agent list — the DashboardAgentCard itself doesn't know about
 * groups, so a simple filter keeps the reuse clean. `ensureLoaded()`
 * is idempotent (a no-op when the dashboard already booted the data).
 */
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { useAgentStore } from '@/stores/agent'
import { useDashboardData } from '@/composables/useDashboardData'
import { useToast } from '@/composables/useToast'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import DashboardAgentCard from '@/components/dashboard/DashboardAgentCard.vue'
import Icon from '@/components/ui/Icon.vue'

const detailStore = useGroupDetailStore()
const agentStore = useAgentStore()
const { agents: allAgents, ensureLoaded } = useDashboardData()
const toast = useToast()
const { confirm } = useConfirmDialog()
const router = useRouter()

const AGENT_CARD_LIMIT = 6

interface StatCard {
  label: string
  value: number
  icon: string
  routeName: string
  description: string
}

const stats = computed<StatCard[]>(() => {
  const group = detailStore.group
  return [
    {
      label: 'Members',
      value: group?.member_count ?? detailStore.members.length,
      icon: 'user',
      routeName: 'group-members',
      description: 'People with access to this group',
    },
    {
      label: 'Agents',
      value: group?.agent_count ?? groupAgents.value.length,
      icon: 'agents',
      routeName: 'group-agents',
      description: 'Agents owned by this group',
    },
    {
      label: 'Tool settings',
      value: group?.tool_setting_count ?? detailStore.toolSettings.length,
      icon: 'tools',
      routeName: 'group-tools',
      description: 'Per-tool configuration overrides',
    },
    {
      label: 'LLM drivers',
      value: group?.llm_config_count ?? detailStore.llmConfigs.length,
      icon: 'brain',
      routeName: 'group-llm-drivers',
      description: 'LLM driver configurations',
    },
  ]
})

/** The group's own agents, scoped by `principal_id`. Sourced from the
 *  shared agent store so the cards have the full Agent shape
 *  (tools, profile_picture, is_favorite, …). */
const groupAgents = computed(() => {
  const groupPrincipalId = detailStore.group?.principal_id
  if (groupPrincipalId === undefined) return [] as typeof allAgents.value
  return allAgents.value.filter((a) => a.principal_id === groupPrincipalId)
})

const visibleAgents = computed(() => groupAgents.value.slice(0, AGENT_CARD_LIMIT))
const hasMoreAgents = computed(() => groupAgents.value.length > AGENT_CARD_LIMIT)

onMounted(() => {
  // ensureLoaded is idempotent — no-op if the dashboard already booted
  // the agent+task stores. Always called so a direct deep-link to a
  // group overview doesn't render an empty snapshot.
  void ensureLoaded()
})

// --- Kebab action wiring (mirrors DashboardPage's handlers) --------------

function onSelect(agentId: number): Promise<unknown> {
  return router.push({ name: 'agent', params: { id: String(agentId) } })
}

function onRunNewTask(agentId: number): Promise<unknown> {
  return router.push({ name: 'agent', params: { id: String(agentId) } })
}

function onSettings(agentId: number): Promise<unknown> {
  return router.push({ name: 'agent-settings', params: { id: String(agentId) } })
}

async function toggleAgentFlag(
  agentId: number,
  column: 'is_archived' | 'is_favorite',
  messages: { flippedOn: string; flippedOff: string; failure: string },
): Promise<void> {
  const agent = agentStore.agents.find((a) => a.id === agentId)
  if (!agent) return
  const nextValue = !agent[column]
  try {
    const updated = await agentStore.updateAgent(agentId, { [column]: nextValue })
    toast.success(updated[column] ? messages.flippedOn : messages.flippedOff)
  } catch {
    toast.error(messages.failure)
  }
}

function onArchive(agentId: number): Promise<void> {
  return toggleAgentFlag(agentId, 'is_archived', {
    flippedOn: 'Archived',
    flippedOff: 'Restored',
    failure: 'Failed to update archive state — try again',
  })
}

function onFavorite(agentId: number): Promise<void> {
  return toggleAgentFlag(agentId, 'is_favorite', {
    flippedOn: 'Added to favorites',
    flippedOff: 'Removed from favorites',
    failure: 'Failed to update favorite state — try again',
  })
}

async function onDelete(agentId: number): Promise<void> {
  const ok = await confirm(
    'Delete this agent? This permanently removes the agent and all its tasks.',
    'Delete agent',
    'Delete',
  )
  if (!ok) return
  try {
    await agentStore.deleteAgent(agentId)
    toast.success('Agent deleted')
  } catch {
    toast.error('Failed to delete agent — try again')
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <header>
      <h1 class="text-lg font-semibold">Overview</h1>
    </header>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      <RouterLink
        v-for="card in stats"
        :key="card.label"
        :to="{ name: card.routeName, params: { id: detailStore.group?.id } }"
        class="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/40"
      >
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs uppercase tracking-wider text-muted-foreground">{{ card.label }}</p>
            <p class="text-2xl font-bold mt-1 tabular-nums">{{ card.value }}</p>
            <p class="text-xs text-muted-foreground mt-1">{{ card.description }}</p>
          </div>
          <span class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground">
            <Icon :name="card.icon" class="h-4 w-4" />
          </span>
        </div>
      </RouterLink>
    </div>

    <section>
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-sm font-semibold">Agents</h2>
        <RouterLink
          v-if="hasMoreAgents"
          :to="{ name: 'group-agents', params: { id: detailStore.group?.id } }"
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all ({{ groupAgents.length }}) →
        </RouterLink>
      </div>

      <div
        v-if="visibleAgents.length === 0"
        class="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center"
      >
        <p class="text-sm text-muted-foreground">No agents yet</p>
        <p class="text-xs text-muted-foreground mt-1">
          Agents owned by this group will appear here as soon as they are created.
        </p>
      </div>

      <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DashboardAgentCard
          v-for="agent in visibleAgents"
          :key="agent.id"
          :agent="agent"
          @select="onSelect"
          @run-new-task="onRunNewTask"
          @settings="onSettings"
          @favorite="onFavorite"
          @archive="onArchive"
          @delete="onDelete"
        />
      </div>
    </section>
  </div>
</template>