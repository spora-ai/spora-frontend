<script setup lang="ts">
/**
 * MyGroupsPage — top-level landing for the groups feature.
 *
 * Distinct from `/admin/groups` (which is the admin overview of every
 * group in the system, with create/delete). This page shows the groups
 * the signed-in caller can SEE — which is filtered server-side via
 * `/api/v1/groups`: admins get every group, non-admins get only the
 * groups they're a member of. Every row links into the GitHub-style
 * org pages at `/groups/:id`.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import { useGroupsStore } from '@/stores/groups'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const groupsStore = useGroupsStore()
const authStore = useAuthStore()

const initialized = ref(false)

onMounted(async () => {
  if (!groupsStore.loading && groupsStore.groups.length === 0) {
    await groupsStore.fetchGroups().catch(() => {
      // Non-fatal: the error block below surfaces the message; the
      // store also sets `error` itself.
    })
  }
  initialized.value = true
})

const isAdmin = computed(() =>
  (authStore.user?.roles ?? []).some((r): boolean => r === 'ADMIN' || r === 'admin'),
)

const headerSubtitle = computed(() =>
  isAdmin.value
    ? 'You see every group in this Spora instance.'
    : 'Groups you belong to. Use them to share agents and settings with a team.',
)

function open(id: number): void {
  void router.push({ name: 'group-overview', params: { id: String(id) } })
}
</script>

<template>
  <div class="flex flex-col gap-6 max-w-5xl mx-auto px-6 py-8">
    <header class="flex items-start justify-between gap-4">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold tracking-tight">Groups</h1>
        <p class="text-sm text-muted-foreground">{{ headerSubtitle }}</p>
      </div>
      <div class="flex items-center gap-2">
        <RouterLink
          v-if="isAdmin"
          to="/admin/groups"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icon name="settings" class="h-4 w-4 mr-1.5" />
          Admin overview
        </RouterLink>
      </div>
    </header>

    <div v-if="!initialized && groupsStore.loading && groupsStore.groups.length === 0"
         class="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
      Loading groups…
    </div>

    <div v-else-if="groupsStore.error && groupsStore.groups.length === 0"
         class="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      {{ groupsStore.error }}
    </div>

    <div v-else-if="groupsStore.groups.length === 0"
         class="rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
      <Icon name="agents" class="h-8 w-8 text-muted-foreground mx-auto mb-3" />
      <h2 class="text-sm font-semibold mb-1">No groups yet</h2>
      <p class="text-xs text-muted-foreground">
        <template v-if="isAdmin">
          You don't have any groups. Create one to share agents and settings with a team.
          <RouterLink to="/admin/groups" class="block mt-4 text-primary hover:underline">
            Create your first group →
          </RouterLink>
        </template>
        <template v-else>
          <span>You aren't in any groups yet. Ask an admin to add you, or look around the</span>
          <RouterLink to="/agents" class="text-primary hover:underline mx-1">agents</RouterLink>
          <span>page to start one on your own.</span>
        </template>
      </p>
    </div>

    <div v-else>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <button
          v-for="group in groupsStore.groups"
          :key="group.id"
          type="button"
          class="text-left rounded-xl border border-border bg-card p-5 hover:border-primary/50 transition-colors flex flex-col gap-3 focus:outline-none focus:ring-2 focus:ring-ring/30"
          @click="open(group.id)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-semibold truncate">{{ group.name }}</div>
              <div v-if="group.description" class="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {{ group.description }}
              </div>
            </div>
            <span v-if="group.member_count !== undefined"
                  class="shrink-0 inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
              {{ group.member_count }}
              {{ group.member_count === 1 ? 'member' : 'members' }}
            </span>
          </div>
          <div class="flex items-center justify-between text-[10px] text-muted-foreground mt-auto">
            <span>ID {{ group.id }}</span>
            <Icon name="chevron-right" class="h-4 w-4" />
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
