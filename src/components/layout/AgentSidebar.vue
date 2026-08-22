<script setup lang="ts">
/**
 * AgentSidebar — left sidebar showing agent list.
 * Used inside AgentLayout on lg+ (desktop) and toggled on mobile.
 *
 * Grouped headings: "My Agents" first, then one section per visible
 * group principal that owns at least one agent in the cache. Agents
 * with no principal (legacy fixtures) fall into a final "Other" bucket.
 *
 * The "+" button opens the unified Create Agent dialog mounted in
 * GlobalNavbar, so the same Blank / Template / Upload picker is
 * available here and on the dashboard.
 */
import { computed, useAttrs } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAgentStore } from '@/stores/agent'
import { usePrincipalsStore } from '@/stores/principals'
import { useAuthStore } from '@/stores/auth'
import { useCreateAgentDialogStore } from '@/stores/createAgentDialog'
import Icon from '@/components/ui/Icon.vue'
import Avatar from '@/components/ui/Avatar.vue'
import type { Agent } from '@/types/agent'

const props = defineProps<{
  agentId: number
  mobileOpen?: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

defineOptions({ inheritAttrs: false })

const router = useRouter()
const agentStore = useAgentStore()
const principalsStore = usePrincipalsStore()
const authStore = useAuthStore()
const createAgentDialog = useCreateAgentDialogStore()

const attrs = useAttrs()
const activeAgentId = computed(() => props.agentId)

const callerId = computed<number | null>(() => authStore.user?.id ?? null)
const callerPrincipalId = computed<number | null>(() => {
  return (
    principalsStore.principals.find(
      (p) => p.type === 'user' && p.user_id === callerId.value,
    )?.id ?? null
  )
})

interface AgentBucket {
  key: string
  label: string
  href: { name: string; params: Record<string, string> } | null
  agents: Agent[]
}

const buckets = computed<AgentBucket[]>(() => {
  const myAgents: Agent[] = []
  const groupAgents = new Map<number, Agent[]>()
  const otherAgents: Agent[] = []

  for (const agent of agentStore.agents) {
    const pid = agent.principal_id
    if (pid !== null && callerPrincipalId.value !== null && pid === callerPrincipalId.value) {
      myAgents.push(agent)
      continue
    }
    if (agent.principal?.type === 'group' && agent.principal.group_id !== undefined) {
      const list = groupAgents.get(agent.principal.group_id) ?? []
      list.push(agent)
      groupAgents.set(agent.principal.group_id, list)
      continue
    }
    otherAgents.push(agent)
  }

  const out: AgentBucket[] = []
  if (myAgents.length > 0) {
    out.push({
      key: 'mine',
      label: 'My Agents',
      href: null,
      agents: myAgents,
    })
  }
  // Group buckets in stable group-id order so the sidebar doesn't
  // reshuffle as agents move between sections.
  const sortedGroupIds = Array.from(groupAgents.keys()).sort((a, b) => a - b)
  for (const gid of sortedGroupIds) {
    const list = groupAgents.get(gid) ?? []
    if (list.length === 0) continue
    const principal = principalsStore.principals.find(
      (p) => p.type === 'group' && p.group_id === gid,
    )
    out.push({
      key: `group-${gid}`,
      label: groupBucketLabel(gid, principal?.name),
      href: { name: 'group-overview', params: { id: String(gid) } },
      agents: list,
    })
  }
  if (otherAgents.length > 0) {
    out.push({
      key: 'other',
      label: 'Other',
      href: null,
      agents: otherAgents,
    })
  }
  return out
})

function navigateToAgent(id: number): void {
  router.push({ name: 'agent', params: { id } })
  closeSidebar()
}

function groupBucketLabel(gid: number, principalName: string | undefined): string {
  const name = principalName ?? `#${gid}`
  return `Group · ${name}`
}

function openCreateDialog(): void {
  createAgentDialog.open('choice')
  closeSidebar()
}

const closeSidebar = (): void => {
  emit('close')
}
</script>

<template>
  <!-- Mobile backdrop -->
  <Transition name="fade">
    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-40 bg-black/50 lg:hidden"
      @click="closeSidebar()"
    />
  </Transition>

  <!-- Sidebar -->
  <aside
    v-bind="attrs"
    class="flex flex-col border-r border-border bg-background shrink-0 overflow-y-auto"
    :class="[
      mobileOpen
        ? 'fixed inset-y-0 left-0 z-50 w-72 shadow-xl lg:hidden'
        : 'hidden lg:flex w-64'
    ]"
  >
    <!-- Sidebar header -->
    <div class="px-4 py-3 border-b border-border flex items-center justify-between bg-background">
      <span class="text-sm font-semibold text-foreground">Agents</span>
      <div class="flex items-center gap-1">
        <button
          @click="openCreateDialog"
          class="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="New Agent"
          aria-label="New Agent"
          type="button"
        >
          <Icon name="plus" />
        </button>
        <button
          v-if="mobileOpen"
          @click="closeSidebar()"
          class="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors lg:hidden"
          title="Close"
          aria-label="Close"
          type="button"
        >
          <Icon name="x" />
        </button>
      </div>
    </div>

    <!-- Agent list (grouped by principal) -->
    <div v-if="buckets.length === 0" class="px-4 py-3 text-xs text-muted-foreground">
      No agents yet.
    </div>
    <div v-for="bucket in buckets" :key="bucket.key" class="py-2">
      <div class="px-4 pt-2 pb-1 flex items-center justify-between">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ bucket.label }}
        </span>
        <RouterLink
          v-if="bucket.href"
          :to="bucket.href"
          class="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Open
        </RouterLink>
      </div>
      <ul>
        <li
          v-for="agent in bucket.agents"
          :key="agent.id"
          @click="navigateToAgent(agent.id)"
          :class="[
            'flex items-center gap-3 px-4 py-2.5 cursor-pointer rounded-lg mx-2 transition-colors',
            agent.id === activeAgentId
              ? 'bg-primary/10 text-primary font-medium'
              : 'hover:bg-muted text-muted-foreground hover:text-foreground'
          ]"
        >
          <Avatar
            :initials="agent.name.charAt(0).toUpperCase()"
            :profile-picture="agent.profile_picture ?? null"
            size="sm"
            tone="muted"
          />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate">{{ agent.name }}</p>
          </div>
        </li>
      </ul>
    </div>

    <!-- Extra slot (e.g. "+ New Agent" button) -->
    <slot name="extra" />
  </aside>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>