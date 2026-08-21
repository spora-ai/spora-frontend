<script setup lang="ts">
/**
 * GroupSubNav — left rail with 6 links to the group's sub-pages.
 *
 * Edit-only items carry an "owner + admin only" hint so a regular
 * member understands why the controls are absent in the deeper pages.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'

defineProps<{
  canEdit: boolean
}>()

interface NavItem {
  name: string
  label: string
  icon: string
  editOnly: boolean
}

const items: NavItem[] = [
  { name: 'group-overview', label: 'Overview', icon: 'compass', editOnly: false },
  { name: 'group-members', label: 'Members', icon: 'user', editOnly: false },
  { name: 'group-agents', label: 'Agents', icon: 'agents', editOnly: false },
  { name: 'group-tools', label: 'Tools', icon: 'tools', editOnly: true },
  { name: 'group-llm-drivers', label: 'LLM Drivers', icon: 'brain', editOnly: true },
  { name: 'group-settings', label: 'Settings', icon: 'settings', editOnly: true },
]

const route = useRoute()
const activeName = computed<string>(() => (typeof route.name === 'string' ? route.name : ''))
</script>

<template>
  <nav class="rounded-xl border border-border bg-card p-2 h-fit">
    <ul class="flex flex-col gap-0.5">
      <li v-for="item in items" :key="item.name">
        <RouterLink
          :to="{ name: item.name, params: { id: route.params.id } }"
          class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
          :class="activeName === item.name
            ? 'bg-muted text-foreground font-medium'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'"
        >
          <Icon :name="item.icon" class="h-4 w-4" />
          <span class="flex-1">{{ item.label }}</span>
          <span
            v-if="item.editOnly && !canEdit"
            class="text-[0.65rem] uppercase tracking-wider rounded bg-muted px-1.5 py-0.5 text-muted-foreground"
            :title="`${item.label} editing requires owner or admin role`"
          >
            owner + admin
          </span>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
