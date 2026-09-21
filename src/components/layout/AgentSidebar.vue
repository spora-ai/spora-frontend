<script setup lang="ts">
/**
 * AgentSidebar — left sidebar showing agent list.
 * Used inside AgentLayout on lg+ (desktop) and toggled on mobile.
 *
 * Layout: the active agent's bucket ("My Agents" or its group) is
 * pinned at the top with a bare label. Every other bucket lives
 * inside a single collapsible "Other agents (N)" panel, including
 * the "Unfiled" fallback for legacy no-principal agents.
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

const activeAgent = computed(() =>
  agentStore.agents.find((a) => a.id === props.agentId) ?? null,
)

/**
 * `mine` (caller's own user-principal) or `group-<gid>`. Matches on
 * `principal.user_id === callerId` rather than just `principal.type
 * === 'user'` because tenants can hold multiple user-principals
 * (delegated users, impersonation) and only the caller's own bucket
 * should pin.
 */
const focusKey = computed<string | null>(() => {
  const a = activeAgent.value
  if (!a) return null
  if (a.principal?.type === 'user' && a.principal.user_id === callerId.value) return 'mine'
  if (a.principal?.type === 'group' && a.principal.group_id !== undefined) {
    return `group-${a.principal.group_id}`
  }
  return 'unfiled'
})

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
  // reshuffle as agents move between sections. The label reads
  // `agent.principal.name` off any member of the bucket — all share
  // the same principal — so it works on first paint without a
  // separate `principalsStore.find()` lookup.
  const sortedGroupIds = Array.from(groupAgents.keys()).sort((a, b) => a - b)
  for (const gid of sortedGroupIds) {
    const list = groupAgents.get(gid) ?? []
    if (list.length === 0) continue
    const principalName = list.find((a) => a.principal?.group_id === gid)?.principal?.name
    out.push({
      key: `group-${gid}`,
      label: principalName ?? `#${gid}`,
      href: { name: 'group-overview', params: { id: String(gid) } },
      agents: list,
    })
  }
  if (otherAgents.length > 0) {
    out.push({
      key: 'unfiled',
      label: 'Unfiled',
      href: null,
      agents: otherAgents,
    })
  }
  return out
})

/**
 * Unfiled is excluded from pinning so legacy no-principal agents
 * stay inside the "Other agents" panel rather than getting a fake
 * focal section at the top.
 */
const pinnedBucket = computed<AgentBucket | undefined>(() => {
  const key = focusKey.value
  if (key === null || key === 'unfiled') return undefined
  return buckets.value.find((b) => b.key === key)
})

const otherBuckets = computed<AgentBucket[]>(() =>
  buckets.value.filter((b) => b.key !== pinnedBucket.value?.key),
)

const totalOtherAgents = computed(() =>
  otherBuckets.value.reduce((sum, b) => sum + b.agents.length, 0),
)

function navigateToAgent(id: number): void {
  router.push({ name: 'agent', params: { id } })
  closeSidebar()
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
    <button
      v-if="mobileOpen"
      type="button"
      aria-label="Close sidebar"
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

    <!-- Empty state -->
    <div
      v-if="buckets.length === 0"
      class="px-4 py-3 text-xs text-muted-foreground"
    >
      No agents yet.
    </div>

    <!-- Pinned section: active agent's own bucket -->
    <div
      v-else-if="pinnedBucket"
      class="py-2"
      data-testid="pinned-bucket"
    >
      <div class="px-4 pt-2 pb-1 flex items-center justify-between">
        <span
          class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          data-testid="pinned-bucket-label"
        >
          {{ pinnedBucket.label }}
        </span>
        <RouterLink
          v-if="pinnedBucket.href"
          :to="pinnedBucket.href"
          class="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Open
        </RouterLink>
      </div>
      <ul>
        <!--
          Layout-only list-item. The clickable surface is the inner
          <button>; the <li> stays so the semantic "agents in a list"
          structure survives a11y tooling that walks list semantics.
          SonarQube Web:S6819 rejects role="button" on a <li>.
        -->
        <li
          v-for="agent in pinnedBucket.agents"
          :key="agent.id"
        >
          <button
            type="button"
            class="flex items-center gap-3 px-4 py-2.5 w-full text-left rounded-lg mx-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            :class="[
              agent.id === activeAgentId
                ? 'bg-primary/10 text-primary font-medium'
                : 'hover:bg-muted text-muted-foreground hover:text-foreground'
            ]"
            :aria-label="`Open agent ${agent.name}`"
            :aria-current="agent.id === activeAgentId ? 'page' : undefined"
            @click="navigateToAgent(agent.id)"
          >
            <Avatar
              :initials="agent.name.charAt(0).toUpperCase()"
              :profile-picture="agent.profile_picture ?? null"
              size="sm"
              tone="muted"
            />
            <span class="flex-1 min-w-0 text-sm font-medium truncate">
              {{ agent.name }}
            </span>
          </button>
        </li>
      </ul>
    </div>

    <!-- Other agents (collapsible) -->
    <details
      v-if="otherBuckets.length > 0"
      class="group py-2"
      data-testid="other-agents-panel"
    >
      <summary class="flex items-center gap-1.5 px-4 pt-2 pb-1 cursor-pointer select-none list-none text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
        <Icon
          name="chevron-right"
          class="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
        />
        <span data-testid="other-agents-summary">Other agents ({{ totalOtherAgents }})</span>
      </summary>
      <div
        v-for="bucket in otherBuckets"
        :key="bucket.key"
        class="py-2"
        data-testid="other-bucket"
      >
        <div class="px-4 pt-2 pb-1 flex items-center justify-between">
          <span
            class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            data-testid="other-bucket-label"
          >
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
          >
            <button
              type="button"
              class="flex items-center gap-3 px-4 py-2.5 w-full text-left rounded-lg mx-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              :class="[
                agent.id === activeAgentId
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-muted text-muted-foreground hover:text-foreground'
              ]"
              :aria-label="`Open agent ${agent.name}`"
              :aria-current="agent.id === activeAgentId ? 'page' : undefined"
              @click="navigateToAgent(agent.id)"
            >
              <Avatar
                :initials="agent.name.charAt(0).toUpperCase()"
                :profile-picture="agent.profile_picture ?? null"
                size="sm"
                tone="muted"
              />
              <span class="flex-1 min-w-0 text-sm font-medium truncate">
                {{ agent.name }}
              </span>
            </button>
          </li>
        </ul>
      </div>
    </details>

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