<script setup lang="ts">
/**
 * GroupOverviewPage — 4 stat cards + recent activity placeholder.
 *
 * The cards deep-link into the matching sub-page; "Recent activity" is
 * intentionally a grey box because the activity stream lives in a
 * separate plan.
 */
import { computed } from 'vue'
import { useGroupDetailStore } from '@/stores/groupDetail'
import Icon from '@/components/ui/Icon.vue'

const detailStore = useGroupDetailStore()

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
      <h2 class="text-sm font-semibold mb-2">Recent activity</h2>
      <div class="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
        <p class="text-sm text-muted-foreground">Coming soon</p>
        <p class="text-xs text-muted-foreground mt-1">
          Activity stream is on the roadmap; the API surface is not yet available.
        </p>
      </div>
    </section>
  </div>
</template>
