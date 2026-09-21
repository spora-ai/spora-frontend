<script setup lang="ts">
/**
 * GlobalSheetGroups — groups list in the navbar sheet. Reads the
 * existing `useGroupsStore` cache (router prefetches it once per
 * session) and renders the user's groups with an active checkmark
 * on the current group, if any. Falls back to initial letters when
 * a group has no profile picture — keeps the tile cheap to render.
 *
 * Also owns the inline "+ New group" affordance: a small form that
 * posts to `groupsStore.createGroup()` and drops the result into the
 * same cache the list reads from. Stays inside the sheet — no dialog
 * hop required for a one-line name entry.
 */
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGroupsStore } from '@/stores/groups'
import Icon from '@/components/ui/Icon.vue'

const router = useRouter()
const route = useRoute()
const groupsStore = useGroupsStore()

const groups = computed(() => groupsStore.groups)

const activeGroupId = computed<number | null>(() => {
  const raw = route.params.id
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw)
  if (Array.isArray(raw) && typeof raw[0] === 'string' && /^\d+$/.test(raw[0])) {
    return Number(raw[0])
  }
  return null
})

const creating = ref(false)
const newGroupName = ref('')
const newGroupError = ref<string | null>(null)
const newGroupInput = ref<HTMLInputElement | null>(null)

async function startCreating(): Promise<void> {
  newGroupName.value = ''
  newGroupError.value = null
  creating.value = true
  await nextTick()
  newGroupInput.value?.focus()
}

function cancelCreating(): void {
  creating.value = false
  newGroupName.value = ''
  newGroupError.value = null
}

async function submitNewGroup(): Promise<void> {
  const name = newGroupName.value.trim()
  if (name === '') return
  newGroupError.value = null
  try {
    const group = await groupsStore.createGroup({ name })
    cancelCreating()
    await router.push({ name: 'group-overview', params: { id: String(group.id) } })
  } catch (e) {
    newGroupError.value = e instanceof Error ? e.message : 'Failed to create group.'
  }
}

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

function tileAccent(name: string): string {
  // Deterministic accent picked from the group's first character so
  // each group always renders the same colour across navigations.
  const palette = [
    'from-violet-500/20 to-violet-500/5 text-violet-700 dark:text-violet-300',
    'from-amber-500/20 to-amber-500/5 text-amber-700 dark:text-amber-300',
    'from-emerald-500/20 to-emerald-500/5 text-emerald-700 dark:text-emerald-300',
    'from-sky-500/20 to-sky-500/5 text-sky-700 dark:text-sky-300',
    'from-rose-500/20 to-rose-500/5 text-rose-700 dark:text-rose-300',
  ]
  const idx = (name.charCodeAt(0) || 0) % palette.length
  return palette[idx] ?? palette[0]!
}

function openGroup(id: number): void {
  void router.push({ name: 'group-overview', params: { id: String(id) } })
}

function seeAll(): void {
  void router.push({ name: 'groups' })
}
</script>

<template>
  <section class="px-5 py-4 border-t border-border">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Groups
      </h2>
      <div class="flex items-center gap-3">
        <button
          v-if="!creating"
          type="button"
          class="text-xs text-primary hover:underline"
          @click="startCreating"
        >
          + New group
        </button>
        <button
          type="button"
          class="text-xs text-primary hover:underline"
          @click="seeAll"
        >
          See all
        </button>
      </div>
    </div>

    <form
      v-if="creating"
      class="mb-3 flex items-center gap-2"
      @submit.prevent="submitNewGroup"
    >
      <input
        ref="newGroupInput"
        v-model="newGroupName"
        type="text"
        placeholder="Group name"
        :disabled="groupsStore.saving"
        class="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        @keydown.escape="cancelCreating"
      >
      <button
        type="submit"
        :disabled="newGroupName.trim() === '' || groupsStore.saving"
        class="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        Create
      </button>
      <button
        type="button"
        :disabled="groupsStore.saving"
        class="h-9 px-3 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        @click="cancelCreating"
      >
        Cancel
      </button>
    </form>
    <p
      v-if="creating && newGroupError"
      class="mb-3 text-xs text-destructive"
    >
      {{ newGroupError }}
    </p>

    <ul
      v-if="groups.length > 0"
      class="space-y-1"
    >
      <li
        v-for="group in groups.slice(0, 5)"
        :key="group.id"
      >
        <button
          type="button"
          class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors"
          :class="activeGroupId === group.id ? 'bg-muted' : 'hover:bg-muted/60'"
          @click="openGroup(group.id)"
        >
          <span
            class="inline-flex shrink-0 items-center justify-center h-8 w-8 rounded-lg font-semibold uppercase tracking-wider bg-gradient-to-br text-xs"
            :class="tileAccent(group.name)"
            aria-hidden="true"
          >
            {{ initials(group.name) }}
          </span>
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
      v-else-if="!creating"
      class="text-sm text-muted-foreground"
    >
      No groups yet
    </p>
  </section>
</template>
