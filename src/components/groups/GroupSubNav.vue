<script setup lang="ts">
/**
 * GroupSubNav — left rail with the sub-pages a member of the group can reach.
 * Edit-only items (Tools / LLM Drivers / Speech / Settings) are hidden entirely
 * for plain members — they show a stripped-down rail (Overview / Members /
 * Agents) instead of fake links that resolve to empty forms. Admins and
 * owner/admin members see the full 7-item set.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Icon } from '@spora-ai/components/icons'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  canEdit: boolean
}>()

interface NavItem {
  name: string
  label: string
  icon: string
  editOnly: boolean
}

// A computed, not a constant: `t()` resolves against the locale active when it
// is called, so a setup-time array would keep the mount-time language.
const allItems = computed<NavItem[]>(() => [
  { name: 'group-overview', label: t('Overview'), icon: 'compass', editOnly: false },
  { name: 'group-members', label: t('Members'), icon: 'user', editOnly: false },
  { name: 'group-agents', label: t('Agents'), icon: 'agents', editOnly: false },
  { name: 'group-tools', label: t('Tools'), icon: 'tools', editOnly: true },
  { name: 'group-llm-drivers', label: t('LLM Drivers'), icon: 'brain', editOnly: true },
  { name: 'group-speech', label: t('Speech'), icon: 'mic', editOnly: true },
  { name: 'group-settings', label: t('Settings'), icon: 'settings', editOnly: true },
])

const items = computed<NavItem[]>(() =>
  props.canEdit ? allItems.value : allItems.value.filter((i) => !i.editOnly),
)

const route = useRoute()
const activeName = computed<string>(() => (typeof route.name === 'string' ? route.name : ''))
</script>

<template>
  <nav class="rounded-xl border border-border bg-card p-2 h-fit">
    <ul class="flex flex-col gap-0.5">
      <li
        v-for="item in items"
        :key="item.name"
      >
        <RouterLink
          :to="{ name: item.name, params: { id: route.params.id } }"
          class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
          :class="activeName === item.name
            ? 'bg-muted text-foreground font-medium'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'"
        >
          <Icon
            :name="item.icon"
            class="h-4 w-4"
          />
          <span class="flex-1">{{ item.label }}</span>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
