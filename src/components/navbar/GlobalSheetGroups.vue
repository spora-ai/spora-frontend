<script setup lang="ts">
/**
 * GlobalSheetGroups — groups list in the navbar sheet. Reads the
 * existing `useGroupsStore` cache (router prefetches it once per
 * session) and renders the user's groups with an active checkmark
 * on the current group, if any. Each tile uses the shared `Avatar`
 * component so a group's uploaded image / archetype avatar shows up
 * here — `Avatar` falls back to initials when no picture is set.
 *
 * Recently used groups float to the top via the `useRecentGroups`
 * composable (localStorage-backed MRU). A small "Show more" button
 * with the same chevron-down/<->chevron-right swap as the chat
 * tool-call expanders replaces the old hard 5-item slice so users
 * with many groups can reach them all from the drawer.
 *
 * The orchestrator handles the navigate-to-group + close-sheet
 * sequence; this component just routes and lets the parent close.
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGroupsStore } from '@/stores/groups'
import { useRecentGroups } from '@/composables/useRecentGroups'
import Avatar from '@/components/ui/Avatar.vue'
import Icon from '@/components/ui/Icon.vue'
import type { Group } from '@/types/principal'

const VISIBLE_LIMIT = 5

const router = useRouter()
const route = useRoute()
const groupsStore = useGroupsStore()
const recent = useRecentGroups()

/**
 * Production reads `groupsStore.groups` as an auto-unwrapped `Group[]`
 * via Pinia. Some test suites stub `useGroupsStore` as `{ groups: ref([]) }`
 * and skip Pinia's auto-unwrap, so we accept both shapes here — the
 * template-only consumers (`.length`, `.slice`) rode on Vue's template
 * auto-unwrap, but `<script setup>` computeds have to read `.value`
 * themselves and would otherwise see a `Ref` and crash on `.map`.
 */
const groupsList = computed<Group[]>(() => {
  const raw = groupsStore.groups as unknown
  if (Array.isArray(raw)) return raw as Group[]
  if (raw !== null && typeof raw === 'object' && 'value' in raw) {
    const v = (raw as { value: unknown }).value
    if (Array.isArray(v)) return v as Group[]
  }
  return []
})

const expanded = ref(false)

const activeGroupId = computed<number | null>(() => {
  const raw = route.params.id
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw)
  if (Array.isArray(raw) && typeof raw[0] === 'string' && /^\d+$/.test(raw[0])) {
    return Number(raw[0])
  }
  return null
})

/**
 * Recents-first ordering. Recent ids (in MRU order) come first; any
 * remaining groups keep their store-order so the drawer stays
 * stable as the cache rehydrates. Groups whose id has been deleted
 * server-side are dropped silently — recents can outlive membership.
 */
const sortedGroups = computed<Group[]>(() => {
  const list = groupsList.value
  if (list.length === 0) return []
  const order = new Map(list.map((g, idx) => [g.id, idx]))
  const present = new Set(list.map((g) => g.id))
  const recents = recent.recentIds.value.filter((id) => present.has(id))
  const rest = list.filter((g) => !recents.includes(g.id))
  rest.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  const byId = new Map(list.map((g) => [g.id, g]))
  return [...recents.map((id) => byId.get(id)!).filter(Boolean), ...rest]
})

const visibleGroups = computed(() =>
  expanded.value ? sortedGroups.value : sortedGroups.value.slice(0, VISIBLE_LIMIT),
)

const canExpand = computed(() => sortedGroups.value.length > VISIBLE_LIMIT)

/**
 * Record a visit whenever the active group id changes (or the user
 * lands on one fresh). Cross-page navigation within the same group
 * (overview -> settings) does not change `activeGroupId`, so it
 * doesn't refire — only true group switches are tracked.
 */
watch(activeGroupId, (id, prev) => {
  if (id !== null && id !== prev) recent.recordVisit(id)
}, { immediate: true })

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

function openGroup(id: number): void {
  recent.recordVisit(id)
  void router.push({ name: 'group-overview', params: { id: String(id) } })
}

function seeAll(): void {
  void router.push({ name: 'groups' })
}

function toggleExpanded(): void {
  expanded.value = !expanded.value
}
</script>

<template>
  <section class="px-5 py-4 border-t border-border">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Groups
      </h2>
      <button
        type="button"
        class="text-xs text-primary hover:underline"
        @click="seeAll"
      >
        See all
      </button>
    </div>
    <ul
      v-if="sortedGroups.length > 0"
      class="space-y-1"
    >
      <li
        v-for="group in visibleGroups"
        :key="group.id"
      >
        <button
          type="button"
          class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors"
          :class="activeGroupId === group.id ? 'bg-muted' : 'hover:bg-muted/60'"
          @click="openGroup(group.id)"
        >
          <Avatar
            :initials="initials(group.name)"
            :profile-picture="group.profile_picture ?? null"
            size="sm"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-foreground truncate">
              {{ group.name }}
            </p>
            <p
              v-if="group.member_count !== undefined"
              class="text-xs text-muted-foreground"
            >
              {{ group.member_count }} {{ group.member_count === 1 ? 'member' : 'members' }}
            </p>
          </div>
          <Icon
            v-if="activeGroupId === group.id"
            name="check"
            class="h-4 w-4 text-primary shrink-0"
          />
        </button>
      </li>
    </ul>
    <p
      v-else
      class="text-sm text-muted-foreground"
    >
      No groups yet
    </p>
    <button
      v-if="canExpand"
      type="button"
      class="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
      :aria-expanded="expanded"
      :aria-label="expanded ? 'Show fewer groups' : 'Show all groups'"
      data-testid="groups-show-more"
      @click="toggleExpanded"
    >
      <Icon
        :name="expanded ? 'chevron-down' : 'chevron-right'"
        class="h-3 w-3"
      />
      <span>{{ expanded ? 'Show less' : 'Show more' }}</span>
      <span class="text-muted-foreground/60">({{ sortedGroups.length }})</span>
    </button>
  </section>
</template>
