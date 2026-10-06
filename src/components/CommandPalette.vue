<script setup lang="ts">
/**
 * CommandPalette — global ⌘K palette.
 *
 * Visibility rule (per plan §3): every section renders only when its
 * match list is non-empty. Empty-query UX has no always-on affordance
 * — the palette is intentionally blank past the input on a cold open.
 *
 * Two source families feed the palette:
 *   - Local sections (actions, groups, my agents, agents by group, recent
 *     chats) read the existing Pinia stores. They stay client-side on
 *     purpose: a server provider for each would have to ship in spora-core.
 *   - Server sections come from `GET /search`, which aggregates every
 *     registered search provider (skills today). The query is debounced and
 *     issued only for a non-empty box.
 *
 * Sections are declared once, in display order, as `sections` below. Both
 * `flatItems` (what ↑/↓ walks) and each section's start offset derive from
 * that one list, so adding a section cannot desynchronise the two.
 *
 * `useDashboardData().ensureLoaded()` is invoked the first time the palette
 * opens and `booted` is still false — the method short-circuits on later
 * calls, so the watcher below is safe to re-fire.
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
import { useCreateAgentDialogStore } from '@/stores/createAgentDialog'
import { useCreateGroupDialogStore } from '@/stores/createGroupDialog'
import { useDashboardData } from '@/composables/useDashboardData'
import { useCommandPalette } from '@/composables/useCommandPalette'
import { useDebounce } from '@/composables/useDebounce'
import { searchApi } from '@/api/search'
import { Icon } from '@spora-ai/components/icons'
import { Avatar } from '@spora-ai/components/avatar'
import type { Agent } from '@/types/agent'
import type { Group } from '@/types/principal'
import type { SearchHit } from '@/types/search'
import type { Task } from '@/types/task'

/**
 * The action rows are typed separately because the template reads `item.id`
 * and `item.label` off them directly, and the hit variant carries neither —
 * its fields live under `hit`. Narrowing here keeps the actions section
 * type-safe without casting at every access.
 */
type PaletteAction = { kind: 'action'; id: string; label: string; subLabel?: string }

type PaletteItem =
  | { kind: 'group'; id: number; label: string; subLabel?: string }
  | { kind: 'agent'; id: number; label: string; subLabel?: string }
  | { kind: 'chat'; id: number; label: string; subLabel?: string }
  | PaletteAction
  | { kind: 'hit'; hit: SearchHit }

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
const createAgentDialog = useCreateAgentDialogStore()
const createGroupDialog = useCreateGroupDialogStore()
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

const actionHits = computed<PaletteAction[]>(() => {
  const needle = q.value.trim().toLowerCase()
  if (needle === '') {
    // Empty query → actions gated on existing context, matching the
    // pre-search UX (create-agent shows when there are user-owned
    // agents to anchor against; create-group when at least one group
    // is loaded so the picker can preselect).
    const items: PaletteAction[] = []
    if (myAgents.value.length > 0) {
      items.push({ kind: 'action', id: 'create-agent', label: 'Create new agent', subLabel: 'Open the create-agent dialog' })
    }
    if (groupHits.value.length > 0) {
      items.push({ kind: 'action', id: 'create-group', label: 'Create new group', subLabel: 'Start a new group' })
    }
    return items
  }
  // Non-empty query → the user is searching for an action. Surface
  // both regardless of the context gates above so "create", "agent",
  // "group" etc. always land on the action. The dialog store itself
  // handles the actual permission check on open().
  const searchable: PaletteAction[] = [
    { kind: 'action', id: 'create-agent', label: 'Create new agent', subLabel: 'Open the create-agent dialog' },
    { kind: 'action', id: 'create-group', label: 'Create new group', subLabel: 'Start a new group' },
  ]
  return searchable.filter((a) =>
    a.label.toLowerCase().includes(needle)
    || (a.subLabel ?? '').toLowerCase().includes(needle),
  )
})

// Long enough to coalesce a burst of keystrokes into one request, short
// enough that the palette still feels instant on a deliberate keystroke.
const SEARCH_DEBOUNCE_MS = 200

/**
 * Monotonic token. Every request start, every reset and every palette close
 * bumps it, so a slow response can tell it has been superseded and drop its
 * result instead of overwriting a newer one — a late answer for `in` must
 * never overwrite the answer for `invoice`. Debouncing alone does not give
 * this: it collapses keystrokes *before* a request is issued, but two
 * requests that were both issued can still resolve out of order.
 */
let searchToken = 0

const serverHits = ref<SearchHit[]>([])
/**
 * Whether the server has answered the current query. Kept apart from
 * "no hits" so the empty state can distinguish *not searched yet* from
 * *searched, nothing found* — without it the block flashes between the
 * keystroke and the first response, then blinks out again when hits land.
 */
const hasSearched = ref(false)

const debouncedQuery = useDebounce<string>('', SEARCH_DEBOUNCE_MS)

watch(q, () => {
  selectedIndex.value = 0
  debouncedQuery.set(q.value.trim())
})

watch(debouncedQuery.value, (needle) => {
  // A blank query is answered client-side by the local sections alone, and
  // the backend short-circuits it to an empty hit list anyway — so skipping
  // the request keeps a cold open free of network chatter.
  if (needle === '') {
    resetSearch()
    return
  }
  void runSearch(needle)
})

async function runSearch(needle: string): Promise<void> {
  const token = ++searchToken
  // Clear before awaiting: the previous query's hits are wrong for the box
  // the operator is looking at right now, and leaving them on screen for the
  // duration of the round-trip reads as "these are the results".
  serverHits.value = []
  hasSearched.value = false
  try {
    const response = await searchApi.search(needle)
    if (token !== searchToken) return
    serverHits.value = response.hits
  } catch {
    // A failed search contributes nothing, mirroring the backend's own
    // fail-soft policy for a provider that throws (SearchProviderRegistry):
    // ⌘K is a global affordance, so one bad request must not take the local
    // sections down with it. `api.get` has already logged the failure.
    if (token !== searchToken) return
    serverHits.value = []
  } finally {
    if (token === searchToken) {
      hasSearched.value = true
    }
  }
}

/**
 * Drop every pending and in-flight search. Called on close and on unmount so
 * a response landing after the palette is gone cannot repopulate it.
 */
function resetSearch(): void {
  searchToken++
  debouncedQuery.cancel()
  serverHits.value = []
  hasSearched.value = false
}

// One section per distinct `hit.type`, in first-appearance order so the
// backend's own ranking (and provider precedence) survives the grouping.
// The registry already de-duplicates on `type::id`, so no second dedupe.
interface HitSection {
  type: string
  hits: SearchHit[]
  /** Title-cased header text: `skill` → `Skill`. */
  label: string
}

const hitSections = computed<HitSection[]>(() => {
  const byType = new Map<string, SearchHit[]>()
  for (const hit of serverHits.value) {
    const bucket = byType.get(hit.type)
    if (bucket === undefined) {
      byType.set(hit.type, [hit])
    } else {
      bucket.push(hit)
    }
  }
  return Array.from(byType.entries()).map(([type, hits]) => ({
    type,
    hits,
    label: type.charAt(0).toUpperCase() + type.slice(1),
  }))
})

/**
 * Every rendered section, in display order, with the rows it contributes to
 * `flatItems`. The single source of truth for two things that used to be
 * hardcoded offset arithmetic over five fixed sections: the flat list the
 * keyboard walks, and the start index each section's rows are numbered from.
 * Deriving both here is what lets the server sections be appended without
 * editing every existing index expression.
 */
interface PaletteSection {
  key: string
  items: PaletteItem[]
}

const sections = computed<PaletteSection[]>(() => [
  { key: 'actions', items: actionHits.value },
  { key: 'groups', items: groupHits.value.map<PaletteItem>((g) => ({ kind: 'group', id: g.id, label: g.name, subLabel: 'Group' })) },
  { key: 'my-agents', items: myAgentHits.value.map<PaletteItem>((a) => ({ kind: 'agent', id: a.id, label: a.name, subLabel: 'My agent' })) },
  ...agentsByGroup.value.map<PaletteSection>((b) => ({
    key: `agents-by-group-${b.group.id}`,
    items: b.agents.map<PaletteItem>((a) => ({
      kind: 'agent',
      id: a.id,
      label: a.name,
      subLabel: b.group.name,
    })),
  })),
  { key: 'chats', items: chatHits.value.map<PaletteItem>((t) => ({
    kind: 'chat',
    id: t.id,
    label: t.user_prompt.slice(0, 80),
    subLabel: t.final_response?.slice(0, 80) ?? undefined,
  })) },
  ...hitSections.value.map<PaletteSection>((s) => ({
    key: `hit-${s.type}`,
    items: s.hits.map<PaletteItem>((hit) => ({ kind: 'hit', hit })),
  })),
])

const flatItems = computed<PaletteItem[]>(() => sections.value.flatMap((s) => s.items))

/**
 * Running index of each section's first row within `flatItems`. Accumulated
 * once per recompute instead of re-derived at every call site, and looked up
 * by section key so the template never does offset arithmetic of its own.
 */
const sectionStarts = computed<Map<string, number>>(() => {
  const starts = new Map<string, number>()
  let cursor = 0
  for (const section of sections.value) {
    starts.set(section.key, cursor)
    cursor += section.items.length
  }
  return starts
})

function indexOf(key: string, offset: number): number {
  return (sectionStarts.value.get(key) ?? 0) + offset
}

/**
 * Whether a row can be opened. `SearchHit.href` is nullable by design — the
 * host has no page for every searchable thing, and none for skills at all —
 * so a null-href hit renders but never navigates. Excluded here rather than
 * in the arrow handler so the "no click, no Enter, not selectable" rule has
 * exactly one definition.
 */
function isActivatable(item: PaletteItem | undefined): boolean {
  if (item === undefined) return false
  if (item.kind === 'hit') return item.hit.href !== null
  return true
}

/**
 * Move the selection to the next activatable row, wrapping in both
 * directions. Inert rows are stepped over rather than landed on, so ↑/↓ can
 * never park the cursor on something Enter will refuse to open — the visual
 * selection and what Enter does would otherwise disagree.
 */
function moveSelection(step: 1 | -1): void {
  const total = flatItems.value.length
  if (total === 0) return
  // At most one full lap, so an all-inert list falls out of the loop with the
  // selection unchanged rather than spinning on a row Enter would refuse.
  for (let hop = 1; hop <= total; hop++) {
    const next = (((selectedIndex.value + step * hop) % total) + total) % total
    if (isActivatable(flatItems.value[next])) {
      selectedIndex.value = next
      return
    }
  }
}

const totalResults = computed<number>(() => flatItems.value.length)

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
    // Reopening starts cold: no debounce pending, nothing in flight, and no
    // hits carried over from the previous session's query.
    resetSearch()
    q.value = ''
    selectedIndex.value = 0
    await nextTick()
    dialogEl.value?.showModal()
    inputRef.value?.focus()
  } else {
    // Bump the token before closing so a response already on the wire
    // resolves into a dropped result rather than a reopened palette.
    resetSearch()
    if (dialogEl.value?.open) {
      dialogEl.value.close()
    }
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
    moveSelection(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    moveSelection(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    activate(flatItems.value[selectedIndex.value])
  }
}

function activate(item: PaletteItem | undefined): void {
  if (item === undefined) return
  if (item.kind === 'hit') {
    // `href` is nullable by design: the host has no page for every
    // searchable thing — none for skills at all — so a provider that cannot
    // name a destination returns here rather than navigating to a 404. No
    // push and no close; the palette stays put and the row stays inert.
    // `isActivatable` is the arrow-key twin of this check.
    const href = item.hit.href
    if (href === null) return
    // A host-supplied path (an app's own skill page), not a route name.
    router.push(href)
    close()
    return
  }
  // Close the palette first so the resulting dialog owns focus. The
  // create-* actions intentionally don't navigate — opening the
  // dialog is the entire affordance, and pushing a route behind it
  // would either flash the wrong page or leave the operator on
  // /groups with no clear breadcrumb back to the dialog.
  if (item.kind === 'group') {
    router.push({ name: 'group-overview', params: { id: String(item.id) } })
  } else if (item.kind === 'agent') {
    router.push({ name: 'agent', params: { id: String(item.id) } })
  } else if (item.kind === 'chat') {
    router.push({ name: 'task', params: { id: String(item.id) } })
  } else if (item.kind === 'action' && item.id === 'create-agent') {
    createAgentDialog.open('choice')
  } else if (item.kind === 'action' && item.id === 'create-group') {
    createGroupDialog.open()
  }
  close()
}

function isSelected(globalIndex: number): boolean {
  return globalIndex === selectedIndex.value
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
  // Drops the pending debounce and invalidates any request still on the wire,
  // so nothing lands in a torn-down component.
  resetSearch()
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
            placeholder="Search agents, groups, chats, skills…"
            aria-label="Search"
            class="flex-1 bg-transparent focus:outline-none text-sm"
            @keydown="onInputKeydown"
          >
          <button
            type="button"
            aria-label="Close palette"
            class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            @click="close"
          >
            <Icon
              name="x"
              class="h-4 w-4"
              aria-hidden="true"
            />
          </button>
        </div>

        <div class="max-h-[55vh] overflow-y-auto">
          <section
            v-if="actionHits.length > 0"
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
                  :aria-selected="isSelected(indexOf('actions', i))"
                  class="w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors"
                  :class="isSelected(indexOf('actions', i)) ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'"
                  @click="activate(item)"
                  @mouseenter="selectedIndex = indexOf('actions', i)"
                >
                  <Icon
                    name="sparkles"
                    class="h-4 w-4 shrink-0"
                  />
                  <span class="flex-1 truncate font-medium">{{ item.label }}</span>
                  <span class="text-xs text-muted-foreground truncate">{{ item.subLabel }}</span>
                </button>
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
                  :aria-selected="isSelected(indexOf('groups', i))"
                  class="w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors"
                  :class="isSelected(indexOf('groups', i)) ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'"
                  @click="activate({ kind: 'group', id: group.id, label: group.name })"
                  @mouseenter="selectedIndex = indexOf('groups', i)"
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
                  :aria-selected="isSelected(indexOf('my-agents', i))"
                  class="w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors"
                  :class="isSelected(indexOf('my-agents', i)) ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'"
                  @click="activate({ kind: 'agent', id: agent.id, label: agent.name })"
                  @mouseenter="selectedIndex = indexOf('my-agents', i)"
                >
                  <Avatar
                    :name="agent.name"
                    :profile-picture="agent.profile_picture ?? null"
                    size="sm"
                  />
                  <span class="flex-1 truncate font-medium">{{ agent.name }}</span>
                  <span class="text-xs text-muted-foreground truncate">My agent</span>
                </button>
              </li>
            </ul>
          </section>

          <section
            v-for="bucket in agentsByGroup"
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
                  :aria-selected="isSelected(indexOf(`agents-by-group-${bucket.group.id}`, i))"
                  class="w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors"
                  :class="isSelected(indexOf(`agents-by-group-${bucket.group.id}`, i)) ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'"
                  @click="activate({ kind: 'agent', id: agent.id, label: agent.name })"
                  @mouseenter="selectedIndex = indexOf(`agents-by-group-${bucket.group.id}`, i)"
                >
                  <Avatar
                    :name="agent.name"
                    :profile-picture="agent.profile_picture ?? null"
                    size="sm"
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
                  :aria-selected="isSelected(indexOf('chats', i))"
                  class="w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors"
                  :class="isSelected(indexOf('chats', i)) ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'"
                  @click="activate({ kind: 'chat', id: task.id, label: task.user_prompt })"
                  @mouseenter="selectedIndex = indexOf('chats', i)"
                >
                  <Avatar
                    v-if="agentById.get(task.agent_id)"
                    :name="agentById.get(task.agent_id)?.name"
                    :profile-picture="agentById.get(task.agent_id)?.profile_picture ?? null"
                    size="sm"
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

          <!--
            Server sections, one per distinct `hit.type`, appended after the
            local ones. A hit with no `href` renders as an inert row rather
            than a button: the host has no page for it, and a disabled-looking
            control that silently does nothing on click reads as a bug.
          -->
          <section
            v-for="section in hitSections"
            :key="`hit-${section.type}`"
            :data-testid="`palette-section-hits-${section.type}`"
            class="py-1"
          >
            <header class="px-4 py-1 flex items-center justify-between">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ section.label }}</span>
              <span class="text-[10px] text-muted-foreground">{{ section.hits.length }}</span>
            </header>
            <ul>
              <li
                v-for="(hit, i) in section.hits"
                :key="`${section.type}-${hit.id}`"
              >
                <!--
                  One element, two states: a button that navigates, or — when
                  the provider named no destination — a div carrying
                  `aria-disabled` with no listeners at all. `:is` keeps the
                  label/badge/subLabel markup single-sourced. A disabled
                  <button> would also be inert, but it still presents as a
                  control that failed rather than as a result the host has
                  nowhere to open.
                -->
                <component
                  :is="hit.href === null ? 'div' : 'button'"
                  :type="hit.href === null ? undefined : 'button'"
                  :aria-disabled="hit.href === null ? 'true' : undefined"
                  :aria-selected="hit.href === null ? 'false' : isSelected(indexOf(`hit-${section.type}`, i))"
                  :data-testid="`palette-item-hit-${section.type}-${hit.id}`"
                  class="w-full flex items-center gap-3 px-4 py-2 text-left text-sm"
                  :class="hit.href === null
                    ? 'text-muted-foreground opacity-70'
                    : (isSelected(indexOf(`hit-${section.type}`, i)) ? 'bg-primary/10 text-primary transition-colors' : 'hover:bg-muted text-foreground transition-colors')"
                  @click="hit.href === null ? undefined : activate({ kind: 'hit', hit })"
                  @mouseenter="hit.href === null ? undefined : (selectedIndex = indexOf(`hit-${section.type}`, i))"
                >
                  <Icon
                    name="search"
                    class="h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="flex-1 truncate font-medium">{{ hit.label }}</span>
                  <span
                    v-if="hit.badge"
                    :data-testid="`palette-item-hit-${section.type}-${hit.id}-badge`"
                    class="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                  >
                    {{ hit.badge }}
                  </span>
                  <span
                    v-if="hit.subLabel"
                    :data-testid="`palette-item-hit-${section.type}-${hit.id}-sublabel`"
                    class="max-w-[40%] truncate text-xs text-muted-foreground"
                  >
                    {{ hit.subLabel }}
                  </span>
                </component>
              </li>
            </ul>
          </section>

          <!--
            The empty block waits for `hasSearched`: while the debounce is
            pending or the request is in flight, "no results yet" is not the
            same answer as "no results", and showing it in between would flash
            it on every keystroke.
          -->
          <div
            v-if="totalResults === 0 && q !== '' && hasSearched"
            data-testid="palette-empty"
            class="px-4 py-8 text-center text-sm text-muted-foreground"
          >
            No matches for "{{ q }}"
          </div>
        </div>

        <footer
          data-testid="palette-footer"
          class="px-4 py-2 border-t border-border flex items-center justify-end text-xs text-muted-foreground"
        >
          <span data-testid="palette-results-count">
            {{ totalResults }} {{ totalResults === 1 ? 'result' : 'results' }}
          </span>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>