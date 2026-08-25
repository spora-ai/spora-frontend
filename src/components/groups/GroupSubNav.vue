<script setup lang="ts">
/**
 * GroupSubNav — left rail with the sub-pages a member of the group
 * can reach. Edit-only items (Tools / LLM Drivers / Settings) are
 * hidden entirely for plain members — they show a stripped-down rail
 * (Overview / Members / Agents) instead of fake links that resolve to
 * empty forms. Admins and owner/admin members see the full 6-item set.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'

const props = defineProps<{
  canEdit: boolean
}>()

interface NavItem {
  name: string
  label: string
  icon: string
  editOnly: boolean
}

const allItems: NavItem[] = [
  { name: 'group-overview', label: 'Overview', icon: 'compass', editOnly: false },
  { name: 'group-members', label: 'Members', icon: 'user', editOnly: false },
  { name: 'group-agents', label: 'Agents', icon: 'agents', editOnly: false },
  { name: 'group-tools', label: 'Tools', icon: 'tools', editOnly: true },
  { name: 'group-llm-drivers', label: 'LLM Drivers', icon: 'brain', editOnly: true },
  { name: 'group-settings', label: 'Settings', icon: 'settings', editOnly: true },
]

const items = computed<NavItem[]>(() =>
  props.canEdit ? allItems : allItems.filter((i) => !i.editOnly),
)

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
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
