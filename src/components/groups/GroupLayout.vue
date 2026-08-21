<script setup lang="ts">
/**
 * GroupLayout — header + sub-nav + <RouterView/> for one group's pages.
 *
 * The header pulls the group detail lazily (no-op if the store already
 * holds it for this id); navigating between sub-pages does not re-fetch.
 * Sub-resources are fetched by their respective pages on mount.
 */
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { ApiError } from '@/api/client'
import GroupSubNav from '@/components/groups/GroupSubNav.vue'
import GlobalNavbar from '@/components/GlobalNavbar.vue'
import Avatar from '@/components/ui/Avatar.vue'

const route = useRoute()
const router = useRouter()
const detailStore = useGroupDetailStore()
const authStore = useAuthStore()
const toast = useToast()

const groupId = computed<number>(() => {
  const raw = route.params.id
  const n = typeof raw === 'string' ? Number(raw) : Number(raw)
  return Number.isFinite(n) ? n : 0
})

const canEdit = computed<boolean>(() => {
  if (authStore.user?.is_admin) return true
  return detailStore.group?.my_role === 'owner' || detailStore.group?.my_role === 'admin'
})

const memberCountDisplay = computed<number>(() => {
  if (detailStore.group?.member_count !== undefined) return detailStore.group.member_count
  return detailStore.members.length
})

onMounted(async () => {
  if (groupId.value > 0 && !detailStore.isLoadedFor(groupId.value)) {
    try {
      await detailStore.fetchDetail(groupId.value)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        router.replace({ name: 'dashboard' })
        return
      }
      toast.error(e instanceof ApiError ? e.message : 'Failed to load group.')
    }
  }
})

watch(groupId, async (id, prev) => {
  if (id === prev || id === 0) return
  if (!detailStore.isLoadedFor(id)) {
    try {
      await detailStore.fetchDetail(id)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        router.replace({ name: 'dashboard' })
      }
    }
  }
})

onUnmounted(() => {
  detailStore.reset()
})

function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const trimmed = name.trim()
  if (trimmed.length === 0) return '?'
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
</script>

<template>
  <div class="min-h-screen bg-background flex flex-col">
    <GlobalNavbar />
    <main class="flex-1 w-full px-4 py-8 max-w-7xl mx-auto">
      <div v-if="detailStore.loading && detailStore.group === null" class="flex items-center gap-4 mb-6">
        <div class="h-12 w-12 rounded-full bg-muted animate-pulse" />
        <div class="flex-1 space-y-2">
          <div class="h-5 w-48 bg-muted animate-pulse rounded" />
          <div class="h-3 w-32 bg-muted animate-pulse rounded" />
        </div>
      </div>

      <template v-else-if="detailStore.group">
        <div class="flex items-start gap-4 mb-6">
          <Avatar
            :initials="initials(detailStore.group.name)"
            :alt="detailStore.group.name"
            size="lg"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-3 flex-wrap">
              <h1 class="text-xl font-bold truncate">{{ detailStore.group.name }}</h1>
              <span class="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                Group #{{ detailStore.group.id }}
              </span>
              <span
                v-if="detailStore.group.my_role"
                class="text-xs rounded-full bg-primary/10 px-2 py-0.5 text-primary font-medium"
              >
                {{ detailStore.group.my_role }}
              </span>
            </div>
            <p v-if="detailStore.group.description" class="text-sm text-muted-foreground mt-1">
              {{ detailStore.group.description }}
            </p>
            <div class="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span>{{ memberCountDisplay }} members</span>
              <template v-if="detailStore.group.agent_count !== undefined">
                <span>·</span>
                <span>{{ detailStore.group.agent_count }} agents</span>
              </template>
            </div>
          </div>
        </div>

        <div
          v-if="detailStore.error"
          role="alert"
          class="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {{ detailStore.error }}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
          <GroupSubNav :can-edit="canEdit" />
          <section class="min-w-0">
            <RouterView />
          </section>
        </div>
      </template>
    </main>
  </div>
</template>
