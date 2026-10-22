<script setup lang="ts">
/**
 * CommandPalette — global ⌘K palette.
 *
 * Every section renders only when its match list is non-empty: a cold open is
 * intentionally blank past the input.
 *
 * Local sections read the Pinia stores — a server provider for each would have
 * to ship in spora-core. Server sections come from `GET /search`, which
 * aggregates the providers plugins register; core registers none, so a stock
 * install renders no server section at all. The query is debounced and issued
 * only for a non-empty box.
 *
 * Sections are declared once, in display order, in `sections` below
 * (`hitSections` feeds the server tail into the same list). `flatItems` (what
 * ↑/↓ walks) and each section's start offset derive from it, so adding a
 * section cannot desynchronise the two.
 *
 * `useDashboardData().ensureLoaded()` short-circuits once it has run, so the
 * open watcher below is safe to re-fire.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
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
const { t } = useI18n()
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
// Palette only needs (id, name) from a group row. The full `Group` shape lives
// in `groupsStore.groups`; `principalsStore.principals` carries a narrower
// `Principal` projected to the same shape, so groups render before the heavier
// /groups fetch lands.
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
  // Cache `principal.name` per group-id so the section header can render the
  // real group name. All agents in a bucket share the same principal, so the
  // first agent's name wins. Falls back to `#<id>` for legacy agents whose
  // principal denormalisation hasn't landed yet.
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
// Indexed lookup so the chat row renders the owning agent without an O(n) scan
// per hit. Missing keys fall back to the chat-icon row (legacy tasks, deleted
// agents).
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
    // Empty query → actions gated on existing context: create-agent shows when
    // there are user-owned agents to anchor against, create-group when at least
    // one group is loaded so the picker can preselect.
    const items: PaletteAction[] = []
    if (myAgents.value.length > 0) {
      items.push({ kind: 'action', id: 'create-agent', label: t('Create new agent'), subLabel: t('Open the create-agent dialog') })
    }
    if (groupHits.value.length > 0) {
      items.push({ kind: 'action', id: 'create-group', label: t('Create new group'), subLabel: t('Start a new group') })
    }
    return items
  }
  // Non-empty query → the user is searching for an action, so surface both
  // regardless of the context gates above: "create", "agent", "group" etc.
  // must always land on the action. The dialog store handles the permission
  // check on open().
  const searchable: PaletteAction[] = [
    { kind: 'action', id: 'create-agent', label: t('Create new agent'), subLabel: t('Open the create-agent dialog') },
    { kind: 'action', id: 'create-group', label: t('Create new group'), subLabel: t('Start a new group') },
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
 * result instead of overwriting a newer one. Debouncing alone does not give
 * this: it collapses keystrokes *before* a request is issued, but two
 * requests that were both issued can still resolve out of order.
 */
let searchToken = 0

const serverHits = ref<SearchHit[]>([])
/**
 * Whether the server has answered the current query. Kept apart from "no
 * hits" so the empty state can distinguish *not searched yet* from *searched,
 * nothing found*.
 */
const hasSearched = ref(false)
/**
 * Whether the current query's request failed. A 5xx says nothing about what
 * matches, so the palette must not render its "no matches" verdict for one.
 */
const searchFailed = ref(false)

const debouncedQuery = useDebounce<string>('', SEARCH_DEBOUNCE_MS)
/**
 * The needle the last debounce committed — what the rows on screen answer.
 * `debouncedQuery.value` is the ref itself, so this keeps the read off the
 * double `.value.value` at the one place that compares against it.
 */
const settledNeedle = debouncedQuery.value

/**
 * Whether an earlier keystroke in the CURRENT debounce window already dropped
 * the rows on screen. The settled ref cannot carry this: Vue skips a watcher
 * when a ref is assigned an equal primitive, so a needle that returns to the
 * value the debounce last committed fires nothing, and the palette would sit
 * blank — rows gone, no request issued, and the empty block still gated on a
 * `hasSearched` nobody is going to set. Recorded here so the revert branch in
 * the watcher below can re-issue the search instead of swallowing the
 * keystroke; `reset('')` handles the same trap across sessions.
 */
let rowsDroppedInWindow = false

watch(q, () => {
  selectedIndex.value = 0
  const needle = q.value.trim()
  // Invalidate on the keystroke rather than when the request is issued: the
  // rows already on screen answer the previous needle and are wrong for the
  // box in front of the operator, both during the debounce window and while
  // the new request is in flight. Bumping the token here also stops an
  // in-flight answer for the old needle from repopulating the list in that
  // window. An edit that leaves the needle alone (a trailing space) changes
  // nothing to invalidate — `settledNeedle` is what the last debounce
  // committed — so those rows stay instead of blanking for a request that is
  // never made.
  if (needle !== settledNeedle.value) {
    invalidateSearch()
    rowsDroppedInWindow = true
  } else if (rowsDroppedInWindow) {
    // Back to the settled needle inside the same window: an earlier keystroke
    // already cleared the rows, and `debouncedQuery.set(needle)` below assigns
    // the value the ref already holds, so the watcher below never fires and the
    // palette would stay blank until the next material keystroke. Re-issue for
    // the needle rather than swallow the edit. A trailing space cannot reach
    // this branch — it leaves the trimmed needle equal to the settled one, so
    // it never took the invalidation branch that sets the flag — and a blank box
    // wants no request either, exactly as on the settled watcher below.
    rowsDroppedInWindow = false
    if (needle !== '') {
      void runSearch(needle)
    }
  }
  debouncedQuery.set(needle)
})

watch(settledNeedle, (needle) => {
  // A blank query is answered client-side by the local sections alone, and
  // the backend short-circuits it to an empty hit list anyway — so skipping
  // the request keeps a cold open free of network chatter.
  if (needle === '') {
    resetSearch()
    return
  }
  // The rows on screen are about to be replaced by this needle's answer, so a
  // pending "the window dropped them" revert no longer owes a request.
  rowsDroppedInWindow = false
  void runSearch(needle)
})

/**
 * `SearchController::MAX_QUERY_LENGTH`. The backend clamps rather than rejects,
 * so a longer needle comes back with a `query` that is not what was sent — and
 * the rows would answer a query the box does not show. Mirrored here so the
 * needle the palette renders, sends and reads back are the same string.
 */
const SEARCH_MAX_QUERY_LENGTH = 200

/**
 * Narrow one wire entry to the fields a palette row actually renders. Anything
 * without a usable string `type`/`id`/`label` cannot be drawn — `hitSections`
 * reads `hit.type` as a Map key and calls `charAt` on it, and the template
 * renders `hit.label` — so a malformed entry would throw *inside a computed
 * during render*, where `runSearch`'s catch cannot reach it. Rejecting here
 * keeps a bad payload a failed search instead of a blank palette and an
 * unhandled rejection.
 */
function toSearchHit(raw: unknown): SearchHit | null {
  if (raw === null || typeof raw !== 'object') return null
  const candidate = raw as Partial<Record<keyof SearchHit, unknown>>
  if (typeof candidate.type !== 'string' || candidate.type === '') return null
  if (typeof candidate.id !== 'string' || candidate.id === '') return null
  if (typeof candidate.label !== 'string') return null
  return {
    type: candidate.type,
    id: candidate.id,
    label: candidate.label,
    // The optional fields are coerced rather than policed: a provider that
    // omits one is describing "nothing to show here", which is exactly what
    // `null` renders, and a wrongly-typed href would otherwise navigate
    // somewhere the backend never named.
    subLabel: typeof candidate.subLabel === 'string' ? candidate.subLabel : null,
    badge: typeof candidate.badge === 'string' ? candidate.badge : null,
    href: typeof candidate.href === 'string' && candidate.href !== '' ? candidate.href : null,
  }
}

/**
 * Validate the whole response body. `api.get` returns `body.data ?? body`, so
 * what lands here is whatever the endpoint produced: a bare array, an object
 * with no `hits`, or `hits: null` all reach it. Only an object whose `hits` is
 * an array of renderable entries is a search answer — anything else means the
 * palette learned nothing about what matches, which is a failed search, not an
 * empty one. Returns null for that case; `runSearch` reports it as unavailable
 * rather than rendering a "0 results" verdict it never received.
 */
function toSearchHits(body: unknown): SearchHit[] | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const raw = (body as { hits?: unknown }).hits
  if (!Array.isArray(raw)) return null
  const hits: SearchHit[] = []
  for (const entry of raw) {
    const hit = toSearchHit(entry)
    // One unusable entry fails the whole payload. Dropping it would render a
    // confident partial list that silently under-reports what the backend
    // found, which is the same false verdict as showing nothing.
    if (hit === null) return null
    hits.push(hit)
  }
  return hits
}

async function runSearch(needle: string): Promise<void> {
  const token = ++searchToken
  try {
    const response = await searchApi.search(needle.slice(0, SEARCH_MAX_QUERY_LENGTH))
    if (token !== searchToken) return
    const hits = toSearchHits(response)
    if (hits === null) {
      // Same verdict as a thrown request: the response says nothing about what
      // matches this needle. `api.get` has already logged the transport failure
      // where there was one.
      serverHits.value = []
      searchFailed.value = true
      return
    }
    serverHits.value = hits
  } catch {
    // A failed search contributes nothing, mirroring the backend's own
    // fail-soft policy for a provider that throws (SearchProviderRegistry):
    // ⌘K is a global affordance, so one bad request must not take the local
    // sections down with it. `api.get` has already logged the failure.
    if (token !== searchToken) return
    serverHits.value = []
    searchFailed.value = true
  } finally {
    if (token === searchToken) {
      hasSearched.value = true
    }
  }
}

/**
 * Drop everything the current query produced: any response still on the wire
 * (through the token) and the rows it would render. Called on close and on
 * unmount so a response landing after the palette is gone cannot repopulate it.
 */
function invalidateSearch(): void {
  searchToken++
  serverHits.value = []
  hasSearched.value = false
  searchFailed.value = false
}

/**
 * Return to a cold palette: nothing pending, nothing in flight, and the
 * debounced query itself back to empty. `reset` rather than `cancel` — the
 * settled value has to move too, or retyping the previous session's query
 * assigns an equal primitive, fires no watcher, and never reaches the network.
 */
function resetSearch(): void {
  rowsDroppedInWindow = false
  debouncedQuery.reset('')
  invalidateSearch()
}

// One section per distinct `hit.type`, in first-appearance order so the
// backend's own ranking (and provider precedence) survives the grouping.
// The registry already de-duplicates on `type::id`, so no second dedupe.
interface HitSection {
  type: string
  hits: SearchHit[]
  /** Title-cased header text: `skill` → `Skill`. */
  label: string
  /**
   * The key this section is registered under in `sections` — `hit-<type>`.
   * Derived here so `sections`, the template's `:key` and every
   * `indexOf(…)` call site read the one string instead of rebuilding it.
   */
  key: string
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
    key: `hit-${type}`,
  }))
})

/**
 * Every rendered section, in display order, with the rows it contributes to
 * `flatItems`. The single source of truth for the flat list the keyboard walks
 * and the start index each section's rows are numbered from — deriving both
 * here is what lets the server sections be appended without editing every
 * existing index expression.
 */
interface PaletteSection {
  key: string
  items: PaletteItem[]
}

const sections = computed<PaletteSection[]>(() => [
  { key: 'actions', items: actionHits.value },
  { key: 'groups', items: groupHits.value.map<PaletteItem>((g) => ({ kind: 'group', id: g.id, label: g.name, subLabel: t('Group') })) },
  { key: 'my-agents', items: myAgentHits.value.map<PaletteItem>((a) => ({ kind: 'agent', id: a.id, label: a.name, subLabel: t('My agent') })) },
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
    key: s.key,
    items: s.hits.map<PaletteItem>((hit) => ({ kind: 'hit', hit })),
  })),
])

const flatItems = computed<PaletteItem[]>(() => sections.value.flatMap((s) => s.items))

/**
 * Park the selection on the first row Enter can actually open. The keystroke
 * watcher pins it to 0 and `moveSelection` starts one hop out, so neither ever
 * re-checks row 0 — a leading null-href hit would sit there looking unselected
 * while Enter did nothing. With nothing activatable there is no such row, so
 * the index falls back to 0 and ↑/↓ are no-ops, which the per-section hint
 * below explains instead.
 */
watch(flatItems, () => {
  if (isActivatable(flatItems.value[selectedIndex.value])) return
  const first = flatItems.value.findIndex((item) => isActivatable(item))
  selectedIndex.value = first === -1 ? 0 : first
})

/**
 * Running index of each section's first row within `flatItems`. Looked up by
 * section key so the template never does offset arithmetic of its own.
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
 * host has no page for every searchable thing, so a provider that cannot name
 * a destination says so rather than inventing a 404 — and a null-href hit
 * renders but never navigates. Excluded here rather than in the arrow handler
 * so the "no click, no Enter, not selectable" rule has exactly one definition.
 */
function isActivatable(item: PaletteItem | undefined): boolean {
  if (item === undefined) return false
  if (item.kind === 'hit') return item.hit.href !== null
  return true
}

/**
 * Whether every hit in a server section is inert. Such a section can show its
 * rows and nothing else: ↑/↓ have nowhere to go and Enter never navigates, so
 * it says so rather than leaving the operator guessing.
 */
function sectionIsInert(section: HitSection): boolean {
  return section.hits.every((hit) => hit.href === null)
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
// `.close()` on a dialog the browser already dismissed with its own Escape
// handling — the browser fires `close` first, then our watcher re-runs.
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
    // `href` is nullable by design: the host has no page for every searchable
    // thing, so a provider that cannot name a destination returns here rather
    // than navigating to a 404. No push and no close; the row stays inert.
    // `isActivatable` is the arrow-key twin of this check.
    const href = item.hit.href
    if (href === null) return
    // A host-supplied path (an app's own skill page), not a route name.
    router.push(href)
    close()
    return
  }
  // Close the palette first so the resulting dialog owns focus. The create-*
  // actions intentionally don't navigate — opening the dialog is the entire
  // affordance, and pushing a route behind it would either flash the wrong
  // page or leave the operator with no breadcrumb back to the dialog.
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

// Mirror the native <dialog> close event back into the singleton. The browser
// fires `close` whether the dialog was dismissed by the user-agent's own Escape
// handling or by an explicit `.close()` from the watcher above, so this single
// handler keeps `isOpen` in sync without a second watcher on `.open`.
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
      Native <dialog> element driven by showModal()/close() in the isOpen
      watcher above. The inner classes override the default UA styles (centered
      0×0 white box) so the backdrop fills the viewport and the panel is
      positioned independently.
    -->
    <dialog
      v-if="isOpen"
      ref="dialogEl"
      class="fixed inset-0 z-[60] m-0 h-screen w-screen p-0 border-0 bg-transparent backdrop:bg-black/50 flex items-start justify-center pt-[15vh] px-4"
      :aria-label="t('Command palette')"
      data-testid="command-palette"
      @close="onDialogClose"
    >
      <button
        type="button"
        :aria-label="t('Close command palette')"
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
            :placeholder="t('Search agents, groups, chats, skills…')"
            :aria-label="t('Search')"
            class="flex-1 bg-transparent focus:outline-none text-sm"
            @keydown="onInputKeydown"
          >
          <button
            type="button"
            :aria-label="t('Close palette')"
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
              <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('Actions') }}</span>
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
              <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('Groups') }}</span>
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
                  <span class="text-xs text-muted-foreground truncate">{{ t('Group') }}</span>
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
              <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('My Agents') }}</span>
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
                  <span class="text-xs text-muted-foreground truncate">{{ t('My agent') }}</span>
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
              <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('Recent chats') }}</span>
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
                  <span class="flex-1 truncate font-medium">{{ task.user_prompt.slice(0, 80) || t('Untitled chat') }}</span>
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
            :key="section.key"
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
                  One element, two states: a button that navigates, or — when the
                  provider named no destination — a plain div whose handlers
                  evaluate to a no-op. `:is` keeps the label/badge/subLabel
                  markup single-sourced. A disabled <button> would also be
                  inert, but it still presents as a control that failed rather
                  than as a result the host has nowhere to open. The inert div
                  carries no `aria-disabled` / `aria-selected`: both are states
                  of a role, and a roleless element exposes neither.
                -->
                <component
                  :is="hit.href === null ? 'div' : 'button'"
                  :type="hit.href === null ? undefined : 'button'"
                  :aria-selected="hit.href === null ? undefined : isSelected(indexOf(section.key, i))"
                  :data-testid="`palette-item-hit-${section.type}-${hit.id}`"
                  class="w-full flex items-center gap-3 px-4 py-2 text-left text-sm"
                  :class="hit.href === null
                    ? 'text-muted-foreground opacity-70'
                    : (isSelected(indexOf(section.key, i)) ? 'bg-primary/10 text-primary transition-colors' : 'hover:bg-muted text-foreground transition-colors')"
                  @click="hit.href === null ? undefined : activate({ kind: 'hit', hit })"
                  @mouseenter="hit.href === null ? undefined : (selectedIndex = indexOf(section.key, i))"
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
            <!--
              Every row here is a result the host has no page for, so ↑/↓ and
              Enter have nothing to do. Without this line the section reads as a
              broken keyboard.
            -->
            <p
              v-if="sectionIsInert(section)"
              :data-testid="`palette-section-hits-${section.type}-inert`"
              class="px-4 pb-1 text-[11px] text-muted-foreground"
            >
              {{ t('Nothing here can be opened from the palette.') }}
            </p>
          </section>

          <!--
            The empty block waits for `hasSearched`: while the debounce is
            pending or the request is in flight, "no results yet" is not the
            same answer as "no results", and showing it in between would flash
            it on every keystroke. `searchFailed` withholds it a second time,
            for a request that errored — an unanswered search is not a verdict.
          -->
          <div
            v-if="totalResults === 0 && q !== '' && hasSearched && !searchFailed"
            data-testid="palette-empty"
            class="px-4 py-8 text-center text-sm text-muted-foreground"
          >
            {{ t('No matches for') }} "{{ q }}"
          </div>
          <!--
            The mirror case: the request failed, so the palette reports the
            search as unavailable rather than "nothing matched", a verdict the
            palette never received.
          -->
          <div
            v-if="totalResults === 0 && q !== '' && searchFailed"
            data-testid="palette-search-failed"
            class="px-4 py-8 text-center text-sm text-muted-foreground"
          >
            {{ t('Search is unavailable') }}
          </div>
        </div>

        <footer
          data-testid="palette-footer"
          class="px-4 py-2 border-t border-border flex items-center justify-end text-xs text-muted-foreground"
        >
          <!--
            The count is withheld when the search failed and nothing else is on
            screen: "0 results" is a verdict about what matches, and a request
            that never got one cannot produce it. With any local row present
            the count still stands — those rows really are the results.
          -->
          <span
            v-if="totalResults > 0 || !searchFailed"
            data-testid="palette-results-count"
          >
            {{ totalResults }} {{ totalResults === 1 ? t('result') : t('results') }}
          </span>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>