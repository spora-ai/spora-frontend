<script setup lang="ts">
/**
 * CommandPalette — global ⌘K palette.
 *
 * Visibility rule (per plan §3): every section renders only when its
 * match list is non-empty. `Actions` is the lone exception: it renders
 * whenever the query is empty, regardless of whether it has any items
 * of its own, so the user sees a stable "empty-query" frame even
 * before any typing. Future contributors: do NOT add an "always show"
 * affordance to the other sections — the empty-state design assumes
 * the palette shows nothing past the input on a clean cold open.
 *
 * Sources are read from existing Pinia stores; no new backend calls
 * are issued. `useDashboardData().ensureLoaded()` is invoked the first
 * time the palette opens and `booted` is still false — the method
 * short-circuits on later calls, so the watcher below is safe to
 * re-fire.
 *
 * Mounting lives in `GlobalNavbar.vue`; the orchestrator (the
 * Sidebar+Palette PR) wires `<CommandPalette />` into the navbar
 * alongside `<CreateAgentDialog />` once both chunks land.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAgentStore } from '@/stores/agent'
import { useTaskStore } from '@/stores/tasks'
import { usePrincipalsStore } from '@/stores/principals'
import { useGroupsStore } from '@/stores/groups'
import { useAuthStore } from '@/stores/auth'
import { useDashboardData } from '@/composables/useDashboardData'
import { useCommandPalette } from '@/composables/useCommandPalette'
import Icon from '@/components/ui/Icon.vue'
import Avatar from '@/components/ui/Avatar.vue'
import type { Agent } from '@/types/agent'
import type { Group } from '@/types/principal'
import type { Task } from '@/types/task'

type PaletteItem =
  | { kind: 'group'; id: number; label: string; subLabel?: string }
  | { kind: 'agent'; id: number; label: string; subLabel?: string }
  | { kind: 'chat'; id: number; label: string; subLabel?: string }
  | { kind: 'action'; id: string; label: string; subLabel?: string }

const props = withDefaults(defineProps<{
  /**
   * Optional id of the "current" group (mirrors the sidebar's pinned
   * bucket). When set, that group is excluded from the "Agents by
   * group" listing so the user doesn't see the same bucket twice.
   */
  focusedGroupId?: number | null
}>(), {
  focusedGroupId: null,
})

const router = useRouter()
const agentStore = useAgentStore()
const taskStore = useTaskStore()
const principalsStore = usePrincipalsStore()
const groupsStore = useGroupsStore()
const authStore = useAuthStore()
const dashboard = useDashboardData()
const { isOpen, close } = useCommandPalette()

const q = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const dialogEl = ref<HTMLDialogElement | null>(null)

const callerId = computed<number | null>(() => authStore.user?.id ?? null)
// Palette only needs (id, name) from a group row. The full `Group`
// shape (description, principal_id, member_count, …) lives in
// `groupsStore.groups`; `principalsStore.principals` carries a
// narrower `Principal` that we project to the same shape so the
// palette renders groups even before the heavier /groups fetch lands.
type PaletteGroup = { id: number; name: string }
const groups = computed<PaletteGroup[]>(() => {
  if (groupsStore.groups.length > 0) {
    return groupsStore.groups.map((g) => ({ id: g.id, name: g.name }))
  }
  return principalsStore.principals
    .filter((p) => p.type === 'group')
    .map((p) => ({ id: p.id, name: p.name }))
})
const myAgents = computed<Agent[]>(() =>
  agentStore.agents.filter(
    (a) => a.principal?.type === 'user' && a.principal.user_id === callerId.value,
  ),
)

function agentMatchesQuery(agent: Agent, needle: string): boolean {
  if (needle === '') return true
  if (agent.name.toLowerCase().includes(needle)) return true
  if (agent.description?.toLowerCase().includes(needle) === true) return true
  return false
}

function groupMatchesQuery(group: PaletteGroup, needle: string): boolean {
  if (needle === '') return true
  return group.name.toLowerCase().includes(needle)
}

function chatMatchesQuery(task: Task, needle: string): boolean {
  if (needle === '') return true
  if (task.user_prompt.toLowerCase().includes(needle)) return true
  if (task.final_response?.toLowerCase().includes(needle) === true) return true
  return false
}

const groupHits = computed<PaletteGroup[]>(() => {
  const needle = q.value.trim().toLowerCase()
  return groups.value.filter((g) => groupMatchesQuery(g, needle))
})
const myAgentHits = computed<Agent[]>(() => {
  const needle = q.value.trim().toLowerCase()
  return myAgents.value.filter((a) => agentMatchesQuery(a, needle))
})
interface GroupBucket {
  group: Group
  agents: Agent[]
}
const agentsByGroup = computed<GroupBucket[]>(() => {
  const needle = q.value.trim().toLowerCase()
  const buckets = new Map<number, Agent[]>()
  // Cache `principal.name` per group-id so the section header below
  // can render the real group name. All agents in a bucket share the
  // same principal, so the first agent's name wins (mirrors the
  // sidebar's approach at AgentSidebar.vue:120). Falls back to
  // `#<id>` for legacy agents whose principal denormalisation hasn't
  // landed yet.
  const nameById = new Map<number, string>()
  for (const agent of agentStore.agents) {
    if (agent.principal?.type !== 'group' || agent.principal.group_id === undefined) continue
    if (!agentMatchesQuery(agent, needle)) continue
    const gid = agent.principal.group_id
    const list = buckets.get(gid) ?? []
    list.push(agent)
    buckets.set(gid, list)
    if (!nameById.has(gid) && agent.principal.name) {
      nameById.set(gid, agent.principal.name)
    }
  }
  return Array.from(buckets.entries())
    .map(([id, agents]) => ({
      group: { id, name: nameById.get(id) ?? `#${id}`, description: null, principal_id: id },
      agents,
    }))
    .filter((b) => props.focusedGroupId === null || b.group.id !== props.focusedGroupId)
})
const chatHits = computed<Task[]>(() => {
  const needle = q.value.trim().toLowerCase()
  const sorted = [...taskStore.tasks].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
  return sorted.filter((t) => chatMatchesQuery(t, needle)).slice(0, 20)
})
// Indexed lookup so the chat row renders the owning agent without an
// O(n) scan per hit. Missing keys fall back to the chat-icon row
// (legacy tasks, deleted agents).
const agentById = computed<Map<number, Agent>>(() => {
  const map = new Map<number, Agent>()
  for (const agent of agentStore.agents) {
    map.set(agent.id, agent)
  }
  return map
})

const actionHits = computed<PaletteItem[]>(() => {
  if (q.value !== '') return []
  const items: PaletteItem[] = []
  if (myAgents.value.length > 0) {
    items.push({ kind: 'action', id: 'create-agent', label: 'Create new agent', subLabel: 'Open the create-agent dialog' })
  }
  if (groupHits.value.length > 0) {
    items.push({ kind: 'action', id: 'create-group', label: 'Create new group', subLabel: 'Start a new group' })
  }
  return items
})

const flatItems = computed<PaletteItem[]>(() => [
  ...actionHits.value,
  ...groupHits.value.map<PaletteItem>((g) => ({ kind: 'group', id: g.id, label: g.name, subLabel: 'Group' })),
  ...myAgentHits.value.map<PaletteItem>((a) => ({ kind: 'agent', id: a.id, label: a.name, subLabel: 'My agent' })),
  ...agentsByGroup.value.flatMap((b) =>
    b.agents.map<PaletteItem>((a) => ({
      kind: 'agent',
      id: a.id,
      label: a.name,
      subLabel: b.group.name,
    })),
  ),
  ...chatHits.value.map<PaletteItem>((t) => ({
    kind: 'chat',
    id: t.id,
    label: t.user_prompt.slice(0, 80),
    subLabel: t.final_response?.slice(0, 80) ?? undefined,
  })),
])

const totalResults = computed<number>(() => flatItems.value.length)

watch(q, () => {
  selectedIndex.value = 0
})
// Drive the native <dialog> element from the singleton `isOpen`.
// `showModal()` places the dialog in the top-layer so the user-agent
// renders focus trap, Escape-to-close, and inert background for free
// (SonarQube Web:S6819 + S6842). The `.open` guard prevents calling
// `.close()` on a dialog that was already dismissed by the browser's
// own Escape handling — the browser fires `close` first, then our
// watcher re-runs, and a naive close() would throw "Cannot close a
// dialog that is already closed".
watch(isOpen, async (open) => {
  if (open) {
    if (!dashboard.booted.value) {
      void dashboard.ensureLoaded()
    }
    q.value = ''
    selectedIndex.value = 0
    await nextTick()
    dialogEl.value?.showModal()
    inputRef.value?.focus()
  } else if (dialogEl.value?.open) {
    dialogEl.value.close()
  }
})
function onInputKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (flatItems.value.length === 0) return
    selectedIndex.value = (selectedIndex.value + 1) % flatItems.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (flatItems.value.length === 0) return
    selectedIndex.value = (selectedIndex.value - 1 + flatItems.value.length) % flatItems.value.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    activate(flatItems.value[selectedIndex.value])
  }
}

function activate(item: PaletteItem | undefined): void {
  if (item === undefined) return
  if (item.kind === 'group') {
    router.push({ name: 'group-overview', params: { id: String(item.id) } })
  } else if (item.kind === 'agent') {
    router.push({ name: 'agent', params: { id: String(item.id) } })
  } else if (item.kind === 'chat') {
    router.push({ name: 'task', params: { id: String(item.id) } })
  } else if (item.kind === 'action' && item.id === 'create-agent') {
    router.push({ name: 'dashboard' })
  } else if (item.kind === 'action' && item.id === 'create-group') {
    router.push({ name: 'groups' })
  }
  close()
}

function isSelected(globalIndex: number): boolean {
  return globalIndex === selectedIndex.value
}

function indexOfGroupStart(bucketIndex: number): number {
  // Sections in flatItems order: actions, groups, myAgents, agentsByGroup, chats.
  return actionHits.value.length
    + groupHits.value.length
    + myAgentHits.value.length
    + agentsByGroup.value.slice(0, bucketIndex).reduce((n, b) => n + b.agents.length, 0)
}

function indexOfChatStart(): number {
  return actionHits.value.length
    + groupHits.value.length
    + myAgentHits.value.length
    + agentsByGroup.value.reduce((n, b) => n + b.agents.length, 0)
}

function onBackdropClick(): void {
  close()
}

// Mirror the native <dialog> close event back into the singleton.
// The browser fires `close` whether the dialog was dismissed by the
// user-agent's own Escape handling or by an explicit `.close()` call
// from the watcher below, so this single handler keeps `isOpen` in
// sync without an extra watcher on the dialog's `.open` property.
function onDialogClose(): void {
  if (isOpen.value) {
    close()
  }
}

onBeforeUnmount(() => {
  close()
})
</script>

<template>
  <Teleport to="body">
    <!--
      Native <dialog> element driven by showModal()/close() in the
      isOpen watcher above. The user-agent renders the focus trap,
      Escape-to-close, and inert background for free; the inner
      classes override the default UA styles (centered 0×0 white box)
      so the backdrop fills the viewport and the panel is positioned
      independently. `data-testid="command-palette"` keeps the
      existing test contract — the dialog element itself receives it.
    -->
    <dialog
      v-if="isOpen"
      ref="dialogEl"
      class="fixed inset-0 z-[60] m-0 h-screen w-screen p-0 border-0 bg-transparent backdrop:bg-black/50 flex items-start justify-center pt-[15vh] px-4"
      aria-label="Command palette"
      data-testid="command-palette"
      @close="onDialogClose"
    >
      <button
        type="button"
        aria-label="Close command palette"
        class="absolute inset-0 cursor-default"
        @click="onBackdropClick"
      />
      <div
        class="relative w-full max-w-2xl bg-background rounded-xl border border-border shadow-2xl overflow-hidden"
      >
        <div class="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Icon
            name="search"
            class="h-4 w-4 text-muted-foreground"
          />
          <input
            ref="inputRef"
            v-model="q"
            type="text"
            placeholder="Search agents, groups, chats…"
            aria-label="Search"
            class="flex-1 bg-transparent focus:outline-none text-sm"
            @keydown="onInputKeydown"
          >
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-0.5 rounded border border-border">
            esc
          </span>
        </div>

        <div class="max-h-[55vh] overflow-y-auto">
          <section
            v-if="q === ''"
            data-testid="palette-section-actions"
            class="py-1"
          >
            <header class="px-4 py-1 flex items-center justify-between">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</span>
              <span class="text-[10px] text-muted-foreground">{{ actionHits.length }}</span>
            </header>
            <ul>
              <li
                v-for="(item, i) in actionHits"
                :key="`action-${item.id}`"
              >
                <button
                  type="button"
                  :data-testid="`palette-item-${item.id}`"
                  :aria-selected="isSelected(i)"
                  class="w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors"
                  :class="isSelected(i) ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'"
                  @click="activate(item)"
                  @mouseenter="selectedIndex = i"
                >
                  <Icon
                    name="sparkles"
                    class="h-4 w-4 shrink-0"
                  />
                  <span class="flex-1 truncate font-medium">{{ item.label }}</span>
                  <span class="text-xs text-muted-foreground truncate">{{ item.subLabel }}</span>
                </button>
              </li>
              <li
                v-if="actionHits.length === 0"
                class="px-4 py-2 text-xs text-muted-foreground"
              >
                No quick actions available.
              </li>
            </ul>
          </section>

          <section
            v-if="groupHits.length > 0"
            data-testid="palette-section-groups"
            class="py-1"
          >
            <header class="px-4 py-1 flex items-center justify-between">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Groups</span>
              <span class="text-[10px] text-muted-foreground">{{ groupHits.length }}</span>
            </header>
            <ul>
              <li
                v-for="(group, i) in groupHits"
                :key="`group-${group.id}`"
              >
                <button
                  type="button"
                  :data-testid="`palette-item-group-${group.id}`"
                  :aria-selected="isSelected(actionHits.length + i)"
                  class="w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors"
                  :class="isSelected(actionHits.length + i) ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'"
                  @click="activate({ kind: 'group', id: group.id, label: group.name })"
                  @mouseenter="selectedIndex = actionHits.length + i"
                >
                  <Icon
                    name="groups"
                    class="h-4 w-4 shrink-0"
                  />
                  <span class="flex-1 truncate font-medium">{{ group.name }}</span>
                  <span class="text-xs text-muted-foreground truncate">Group</span>
                </button>
              </li>
            </ul>
          </section>

          <section
            v-if="myAgentHits.length > 0"
            data-testid="palette-section-my-agents"
            class="py-1"
          >
            <header class="px-4 py-1 flex items-center justify-between">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">My Agents</span>
              <span class="text-[10px] text-muted-foreground">{{ myAgentHits.length }}</span>
            </header>
            <ul>
              <li
                v-for="(agent, i) in myAgentHits"
                :key="`mine-${agent.id}`"
              >
                <button
                  type="button"
                  :data-testid="`palette-item-agent-${agent.id}`"
                  :aria-selected="isSelected(actionHits.length + groupHits.length + i)"
                  class="w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors"
                  :class="isSelected(actionHits.length + groupHits.length + i) ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'"
                  @click="activate({ kind: 'agent', id: agent.id, label: agent.name })"
                  @mouseenter="selectedIndex = actionHits.length + groupHits.length + i"
                >
                  <Avatar
                    :initials="agent.name.charAt(0).toUpperCase()"
                    :profile-picture="agent.profile_picture ?? null"
                    size="sm"
                    tone="muted"
                  />
                  <span class="flex-1 truncate font-medium">{{ agent.name }}</span>
                  <span class="text-xs text-muted-foreground truncate">My agent</span>
                </button>
              </li>
            </ul>
          </section>

          <section
            v-for="(bucket, bucketIndex) in agentsByGroup"
            :key="`bucket-${bucket.group.id}`"
            :data-testid="`palette-section-agents-by-group-${bucket.group.id}`"
            class="py-1"
          >
            <header class="px-4 py-1 flex items-center justify-between">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {{ bucket.group.name || `#${bucket.group.id}` }}
              </span>
              <span class="text-[10px] text-muted-foreground">{{ bucket.agents.length }}</span>
            </header>
            <ul>
              <li
                v-for="(agent, i) in bucket.agents"
                :key="`bygroup-${bucket.group.id}-${agent.id}`"
              >
                <button
                  type="button"
                  :data-testid="`palette-item-agent-${agent.id}`"
                  :aria-selected="isSelected(indexOfGroupStart(bucketIndex) + i)"
                  class="w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors"
                  :class="isSelected(indexOfGroupStart(bucketIndex) + i) ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'"
                  @click="activate({ kind: 'agent', id: agent.id, label: agent.name })"
                  @mouseenter="selectedIndex = indexOfGroupStart(bucketIndex) + i"
                >
                  <Avatar
                    :initials="agent.name.charAt(0).toUpperCase()"
                    :profile-picture="agent.profile_picture ?? null"
                    size="sm"
                    tone="muted"
                  />
                  <span class="flex-1 truncate font-medium">{{ agent.name }}</span>
                  <span class="text-xs text-muted-foreground truncate">{{ bucket.group.name || `#${bucket.group.id}` }}</span>
                </button>
              </li>
            </ul>
          </section>

          <section
            v-if="chatHits.length > 0"
            data-testid="palette-section-recent-chats"
            class="py-1"
          >
            <header class="px-4 py-1 flex items-center justify-between">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent chats</span>
              <span class="text-[10px] text-muted-foreground">{{ chatHits.length }}</span>
            </header>
            <ul>
              <li
                v-for="(task, i) in chatHits"
                :key="`chat-${task.id}`"
              >
                <button
                  type="button"
                  :data-testid="`palette-item-chat-${task.id}`"
                  :aria-selected="isSelected(indexOfChatStart() + i)"
                  class="w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors"
                  :class="isSelected(indexOfChatStart() + i) ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'"
                  @click="activate({ kind: 'chat', id: task.id, label: task.user_prompt })"
                  @mouseenter="selectedIndex = indexOfChatStart() + i"
                >
                  <Avatar
                    v-if="agentById.get(task.agent_id)"
                    :initials="(agentById.get(task.agent_id)?.name ?? '?').charAt(0).toUpperCase()"
                    :profile-picture="agentById.get(task.agent_id)?.profile_picture ?? null"
                    size="sm"
                    tone="muted"
                  />
                  <Icon
                    v-else
                    name="chat"
                    class="h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="flex-1 truncate font-medium">{{ task.user_prompt.slice(0, 80) || 'Untitled chat' }}</span>
                  <span
                    v-if="agentById.get(task.agent_id)"
                    class="text-xs text-muted-foreground truncate"
                    :data-testid="`palette-item-chat-${task.id}-agent`"
                  >
                    {{ agentById.get(task.agent_id)?.name }}
                  </span>
                </button>
              </li>
            </ul>
          </section>

          <div
            v-if="totalResults === 0 && q !== ''"
            data-testid="palette-empty"
            class="px-4 py-8 text-center text-sm text-muted-foreground"
          >
            No matches for "{{ q }}"
          </div>
        </div>

        <footer
          data-testid="palette-footer"
          class="px-4 py-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground"
        >
          <span data-testid="palette-results-count">
            {{ totalResults }} {{ totalResults === 1 ? 'result' : 'results' }}
          </span>
          <span
            data-testid="palette-sources-pill"
            class="px-2 py-0.5 rounded border border-border"
          >
            4 sources
          </span>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>