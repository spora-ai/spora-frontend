<script setup lang="ts">
/**
 * GroupOverviewPage — 4 stat cards + a snapshot of the group's agents.
 *
 * The cards deep-link into the matching sub-page. The agent snapshot
 * mirrors the dashboard's "view all" treatment: first 6 agents as
 * cards, then a "View all" link to /groups/:id/agents for the rest.
 *
 * Agents are fetched lazily on mount if the store hasn't loaded them
 * yet — the user might land on the overview without ever having
 * visited /groups/:id/agents.
 */
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { ApiError } from '@/api/client'
import { useToast } from '@/composables/useToast'
import Icon from '@/components/ui/Icon.vue'

const detailStore = useGroupDetailStore()
const toast = useToast()
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
      value: group?.agent_count ?? detailStore.agents.length,
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

const visibleAgents = computed(() => detailStore.agents.slice(0, AGENT_CARD_LIMIT))
const hasMoreAgents = computed(() => detailStore.agents.length > AGENT_CARD_LIMIT)

onMounted(async () => {
  const groupId = detailStore.group?.id
  if (groupId === undefined || groupId === 0) return
  // The store caches by id; a no-op when the agents sub-page already populated it.
  if (detailStore.agents.length > 0) return
  try {
    await detailStore.fetchAgents(groupId)
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to load agents.')
  }
})

function openAgent(agentId: number): void {
  router.push({ name: 'agent', params: { id: String(agentId) } })
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <header>
      <h1 class="text-lg font-semibold">Overview</h1>
      <p class="text-sm text-muted-foreground mt-0.5">
        High-level summary of this group's resources.
      </p>
    </header>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          View all ({{ detailStore.agents.length }}) →
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

      <ul v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <li
          v-for="agent in visibleAgents"
          :key="agent.id"
        >
          <button
            type="button"
            @click="openAgent(agent.id)"
            class="w-full flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <span
              class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-foreground shrink-0"
              aria-hidden="true"
            >
              {{ agent.name.charAt(0).toUpperCase() }}
            </span>
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-medium truncate">{{ agent.name }}</span>
              <span class="block text-xs text-muted-foreground">Agent #{{ agent.id }}</span>
            </span>
            <Icon name="arrow-right" class="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>