<script setup lang="ts">
/**
 * OwnerBadge — small chip that surfaces the agent's owning principal.
 *
 * Four render branches:
 *  - principal is null → no badge rendered
 *  - principal is the caller (`type === 'user'`, `user_id === auth.user.id`)
 *    → "You" (no link)
 *  - principal is another user → "User · {name}" (no link)
 *  - principal is a group → "Group · {name}" linking to /groups/:id
 *
 * The component is fully data-driven from `Agent.principal` and the
 * signed-in user from `useAuthStore`. No props beyond the agent.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import type { Agent } from '@/types/agent'

const props = defineProps<{
  agent: Agent
}>()

const authStore = useAuthStore()

const principal = computed(() => props.agent.principal ?? null)

const isMine = computed<boolean>(() => {
  const p = principal.value
  if (p === null) return false
  if (p.type !== 'user') return false
  const me = authStore.user
  if (me === null) return false
  return p.user_id === me.id
})

const label = computed<string>(() => {
  const p = principal.value
  if (p === null) return 'Owner unknown'
  if (p.type === 'user') {
    return isMine.value ? 'You' : `User · ${p.name}`
  }
  return `Group · ${p.name}`
})

const to = computed(() => {
  const p = principal.value
  if (p === null || p.type !== 'group') return null
  return { name: 'group-overview', params: { id: String(p.group_id) } }
})
</script>

<template>
  <span v-if="principal" class="owner-badge" :data-owner-type="principal.type">
    <template v-if="to">
      <RouterLink :to="to" class="owner-badge-link">{{ label }}</RouterLink>
    </template>
    <template v-else>
      <span class="owner-badge-static">{{ label }}</span>
    </template>
  </span>
</template>

<style scoped>
.owner-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  background: hsl(var(--muted));
  padding: 0.125rem 0.5rem;
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1.3;
  color: hsl(var(--muted-foreground));
}
.owner-badge[data-owner-type='group'] {
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
}
.owner-badge-link,
.owner-badge-static {
  color: inherit;
  text-decoration: none;
}
.owner-badge-link:hover {
  text-decoration: underline;
}
</style>