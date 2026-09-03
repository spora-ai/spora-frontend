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
 * The group's profile picture is edited on the settings page, not
 * here — see `GroupSettingsPage` / `GroupProfilePictureSection`.
 * The avatar in the `GroupLayout` header shows the current picture
 * (or initials fallback) read-only.
 *
 * Data flow: `useDashboardData()` shares its agent+task stores with
 * the dashboard. We scope to the group's principal by filtering the
 * shared agent list — the DashboardAgentCard itself doesn't know about
 * groups, so a simple filter keeps the reuse clean. `ensureLoaded()`
 * is idempotent (a no-op when the dashboard already booted the data).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { useAgentStore } from '@/stores/agent'
import { useTaskStore } from '@/stores/tasks'
import { buildTaskCountByAgent, compareAgents, useDashboardData, type DashboardSort } from '@/composables/useDashboardData'
import { useCreateAgentDialogStore } from '@/stores/createAgentDialog'
import { useToast } from '@/composables/useToast'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import DashboardAgentCard from '@/components/dashboard/DashboardAgentCard.vue'
import Icon from '@/components/ui/Icon.vue'

interface SortOption {
  value: DashboardSort
  label: string
}

/** Same options as the dashboard toolbar so the two surfaces sort the same way. */
const SORT_OPTIONS: ReadonlyArray<SortOption> = [
  { value: 'activity', label: 'Last activity' },
  { value: 'name', label: 'Name' },
  { value: 'created', label: 'Recently created' },
  { value: 'tasks', label: 'Task count' },
]

const detailStore = useGroupDetailStore()
const agentStore = useAgentStore()
const taskStore = useTaskStore()
const createDialog = useCreateAgentDialogStore()
const { agents: allAgents, ensureLoaded } = useDashboardData()
// tasks is the raw task list; we derive taskCountByAgent from it locally
// so the comparator has the same shape the dashboard uses.
const tasks = taskStore.tasks
const toast = useToast()
const { confirm } = useConfirmDialog()
const router = useRouter()

const AGENT_CARD_LIMIT = 6

/** Sort key for the non-favourite agents section. Local state — the
 *  group overview is a separate surface from the dashboard and the two
 *  should not share a sort dropdown. Defaults to activity (matches the
 *  dashboard's default). */
const sort = ref<DashboardSort>('activity')

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

/** The group's favourite agents, in the order they appear in `groupAgents`.
 *  Not capped — the dashboard's favourites section also shows every
 *  favourite, and the group snapshot follows the same precedent. */
const favoriteGroupAgents = computed(() =>
  groupAgents.value.filter((a) => (a as { is_favorite?: boolean }).is_favorite === true),
)

/** Non-favourite group agents, sorted by the local sort key and capped at
 *  `AGENT_CARD_LIMIT`. The comparator is shared with the dashboard so the
 *  two surfaces agree on what "last activity" or "task count" means. */
const nonFavoriteGroupAgents = computed(() => {
  const sortKey = sort.value
  const lastTaskMap = taskStore.lastTaskByAgent
  const taskCountMap = buildTaskCountByAgent(tasks)
  const rest = groupAgents.value.filter((a) => (a as { is_favorite?: boolean }).is_favorite !== true)
  return [...rest]
    .sort((a, b) => compareAgents(a, b, sortKey, lastTaskMap, taskCountMap))
    .slice(0, AGENT_CARD_LIMIT)
})

/** True when there's at least one non-favourite agent that's been
 *  clipped by the card limit — the "View all" link only makes sense when
 *  the cap actually hides something. */
const hasMoreAgents = computed(() => {
  const total = groupAgents.value.length
  const visibleNonFav = nonFavoriteGroupAgents.value.length
  return total - favoriteGroupAgents.value.length > visibleNonFav
})

onMounted(() => {
  // ensureLoaded is idempotent — no-op if the dashboard already booted
  // the agent+task stores. Always called so a direct deep-link to a
  // group overview doesn't render an empty snapshot.
  void ensureLoaded()
})

function onSortChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  sort.value = target.value as DashboardSort
}

function onSelect(agentId: number): Promise<unknown> {
  return router.push({ name: 'agent', params: { id: String(agentId) } })
}

function onNewAgent(): void {
  const pid = detailStore.group?.principal_id
  if (pid === undefined) return
  createDialog.open('choice', pid)
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
  // Plan A: favourites live on POST/DELETE /agents/{id}/favorite. The
  // legacy PATCH /agents/{id} no longer accepts `is_favorite` (the
  // column is gone in favour of a per-user pivot row). Route through
  // agentStore.setFavorite which toggles the pivot + re-fetches the
  // agent so the store reflects the new value.
  const agent = agentStore.agents.find((a) => a.id === agentId)
  if (!agent) return Promise.resolve()
  const nextValue = !agent.is_favorite
  return agentStore
    .setFavorite(agentId, nextValue)
    .then((updated) => {
      toast.success(updated.is_favorite ? 'Added to favorites' : 'Removed from favorites')
    })
    .catch(() => {
      toast.error('Failed to update favorite state — try again')
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

    <section v-if="favoriteGroupAgents.length > 0">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-sm font-semibold">Favorites</h2>
        <span class="text-xs text-muted-foreground">&middot; {{ favoriteGroupAgents.length }} agent{{ favoriteGroupAgents.length === 1 ? '' : 's' }}</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DashboardAgentCard
          v-for="agent in favoriteGroupAgents"
          :key="`fav-${agent.id}`"
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

    <section>
      <div class="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <h2 class="text-sm font-semibold">Agents</h2>
        <div class="flex items-center gap-3">
          <label v-if="nonFavoriteGroupAgents.length > 0" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Sort</span>
            <select
              :value="sort"
              aria-label="Sort agents"
              class="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              @change="onSortChange"
            >
              <option v-for="opt in SORT_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </label>
          <RouterLink
            v-if="hasMoreAgents"
            :to="{ name: 'group-agents', params: { id: detailStore.group?.id } }"
            class="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View all ({{ groupAgents.length }}) →
          </RouterLink>
        </div>
      </div>

      <div
        v-if="nonFavoriteGroupAgents.length === 0 && favoriteGroupAgents.length === 0"
        class="rounded-xl border border-dashed border-border bg-muted/30 p-8 flex flex-col items-center text-center gap-3"
      >
        <p class="text-sm text-muted-foreground">No agents yet</p>
        <p class="text-xs text-muted-foreground max-w-sm">
          Agents owned by this group will appear here as soon as they are created.
        </p>
        <button
          v-if="detailStore.group?.principal_id !== undefined"
          type="button"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          @click="onNewAgent"
        >
          <Icon name="plus" class="h-4 w-4 mr-1" />
          New agent
        </button>
      </div>

      <div v-else-if="nonFavoriteGroupAgents.length > 0" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DashboardAgentCard
          v-for="agent in nonFavoriteGroupAgents"
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