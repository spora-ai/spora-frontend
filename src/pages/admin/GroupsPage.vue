<script setup lang="ts">
/**
 * GroupsPage — admin group management page.
 * Route: /settings/admin/groups
 *
 * Row click navigates to /groups/:id (GroupOverviewPage). Inline name
 * edits and deletes remain for the canonical admin flows.
 *
 * The list shows each group's profile picture (Avatar component) so
 * operators can scan the roster visually. Two sort orders are exposed
 * via a select — the backend already returns groups ordered by name,
 * so "Name (A→Z)" is the natural default; "Recent (newest first)"
 * sorts client-side on the already-fetched list by created_at desc.
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useGroupsStore } from '@/stores/groups'
import { ApiError } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useAdminAuth } from '@/composables/useAdminAuth'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminForbidden from '@/components/admin/AdminForbidden.vue'
import Avatar from '@/components/ui/Avatar.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/Modal.vue'
import type { Group } from '@/types/principal'

type GroupSort = 'name' | 'recent'

const { isAdmin } = useAdminAuth()
const groupsStore = useGroupsStore()
const toast = useToast()
const router = useRouter()

const sortBy = ref<GroupSort>('name')

const sortedGroups = computed<Group[]>(() => {
  const list = [...groupsStore.groups]
  if (sortBy.value === 'recent') {
    // Newest first; fall back to name for stable order when timestamps tie.
    list.sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : 0
      const tb = b.created_at ? Date.parse(b.created_at) : 0
      if (tb !== ta) return tb - ta
      return a.name.localeCompare(b.name)
    })
  } else {
    list.sort((a, b) => a.name.localeCompare(b.name))
  }
  return list
})

function groupInitials(name: string | null | undefined): string {
  if (!name) return '?'
  const trimmed = name.trim()
  if (trimmed.length === 0) return '?'
  return trimmed.charAt(0).toUpperCase()
}

const showCreate = ref(false)
const createForm = ref({ name: '', description: '' })
const creating = ref(false)
const createError = ref<string | null>(null)

async function createGroup(): Promise<void> {
  if (!createForm.value.name.trim()) return
  createError.value = null
  creating.value = true
  try {
    await groupsStore.createGroup({
      name: createForm.value.name,
      description: createForm.value.description || undefined,
    })
    toast.success('Group created.')
    showCreate.value = false
    createForm.value = { name: '', description: '' }
  } catch (e) {
    createError.value = e instanceof ApiError ? e.message : 'Failed to create group.'
  } finally {
    creating.value = false
  }
}

const editingGroup = ref<Group | null>(null)
const isEditingOpen = computed<boolean>({
  get: () => editingGroup.value !== null,
  set: (v: boolean) => { if (!v) editingGroup.value = null },
})

const editForm = ref({ name: '', description: '' })
const saving = ref(false)
const editError = ref<string | null>(null)

function openEdit(group: Group): void {
  editingGroup.value = group
  editForm.value = {
    name: group.name,
    description: group.description ?? '',
  }
  editError.value = null
}

async function saveEdit(): Promise<void> {
  if (!editingGroup.value) return
  saving.value = true
  editError.value = null
  try {
    await groupsStore.updateGroup(editingGroup.value.id, {
      name: editForm.value.name,
      description: editForm.value.description || undefined,
    })
    toast.success('Group updated.')
    isEditingOpen.value = false
  } catch (e) {
    editError.value = e instanceof ApiError ? e.message : 'Failed to update group.'
  } finally {
    saving.value = false
  }
}

const deletingGroup = ref<Group | null>(null)
const isDeleteOpen = computed<boolean>({
  get: () => deletingGroup.value !== null,
  set: (v: boolean) => { if (!v) deletingGroup.value = null },
})

async function confirmDelete(): Promise<void> {
  if (!deletingGroup.value) return
  saving.value = true
  try {
    await groupsStore.deleteGroup(deletingGroup.value.id)
    toast.success('Group deleted.')
    isDeleteOpen.value = false
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to delete group.')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  try {
    await groupsStore.fetchGroups()
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to load groups.')
  }
})

function openGroup(group: Group): void {
  router.push({ name: 'group-overview', params: { id: group.id } })
}
</script>

<template>
  <AdminForbidden v-if="!isAdmin" />

  <AdminSection
    v-else
    title="Groups"
    description="Manage RBAC groups for shared agent ownership."
  >
    <div class="flex items-center justify-between mb-6">
      <label class="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Sort by</span>
        <select
          v-model="sortBy"
          data-testid="group-sort"
          class="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="name">Name (A→Z)</option>
          <option value="recent">Recent (newest first)</option>
        </select>
      </label>
      <button
        @click="showCreate = true"
        class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        type="button"
      >
        <Icon name="plus" class="h-4 w-4 mr-1.5" />
        Create Group
      </button>
    </div>

    <div v-if="groupsStore.loading && groupsStore.groups.length === 0" class="flex items-center justify-center py-12 text-sm text-muted-foreground">
      Loading…
    </div>

    <div v-else-if="groupsStore.error && groupsStore.groups.length === 0" class="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      {{ groupsStore.error }}
    </div>

    <div v-else class="rounded-xl border border-border overflow-x-scroll">
      <table class="w-full text-sm">
        <thead class="bg-muted/40">
          <tr>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground w-14">ID</th>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground w-14">Picture</th>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground">Members</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="group in sortedGroups" :key="group.id" class="hover:bg-muted/20 transition-colors">
            <td class="px-4 py-3 text-muted-foreground font-mono">{{ group.id }}</td>
            <td class="px-4 py-3">
              <Avatar
                :initials="groupInitials(group.name)"
                :profile-picture="group.profile_picture ?? null"
                size="sm"
              />
            </td>
            <td class="px-4 py-3 font-medium">
              <button
                type="button"
                @click="openGroup(group)"
                class="text-primary hover:underline focus:outline-none focus:underline"
              >
                {{ group.name }}
              </button>
            </td>
            <td class="px-4 py-3 text-muted-foreground">{{ group.description || '—' }}</td>
            <td class="px-4 py-3">{{ group.member_count ?? 0 }}</td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-1 justify-end">
                <button
                  @click="openGroup(group)"
                  title="Open group"
                  class="flex items-center justify-center h-7 w-7 rounded-lg text-foreground hover:bg-muted transition-colors"
                  type="button"
                >
                  <Icon name="user" class="h-4 w-4" />
                </button>
                <button
                  @click="openEdit(group)"
                  title="Edit group"
                  class="flex items-center justify-center h-7 w-7 rounded-lg text-foreground hover:bg-muted transition-colors"
                  type="button"
                >
                  <Icon name="pencil" class="h-4 w-4" />
                </button>
                <button
                  @click="deletingGroup = group"
                  title="Delete group"
                  class="flex items-center justify-center h-7 w-7 rounded-lg text-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  type="button"
                >
                  <Icon name="trash" class="h-4 w-4" />
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="groupsStore.groups.length === 0">
            <td colspan="6" class="px-4 py-8 text-center text-muted-foreground">No groups found.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </AdminSection>

  <Modal v-model="showCreate" title="Create Group" size="sm" @close="showCreate = false">
    <form @submit.prevent="createGroup" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <label for="create-group-name" class="text-sm font-medium">Name</label>
        <input
          id="create-group-name"
          v-model="createForm.name"
          type="text"
          required
          placeholder="Engineering"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <label for="create-group-desc" class="text-sm font-medium">Description</label>
        <textarea
          id="create-group-desc"
          v-model="createForm.description"
          rows="3"
          placeholder="Optional"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <p v-if="createError" role="alert" class="text-xs text-destructive">{{ createError }}</p>
    </form>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          @click="showCreate = false"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          type="button"
        >
          Cancel
        </button>
        <button
          @click="createGroup"
          :disabled="creating || !createForm.name.trim()"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          type="button"
        >
          {{ creating ? 'Creating…' : 'Create Group' }}
        </button>
      </div>
    </template>
  </Modal>

  <Modal v-model="isEditingOpen" :title="`Edit ${editingGroup?.name}`" size="sm" @close="isEditingOpen = false">
    <form @submit.prevent="saveEdit" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <label for="edit-group-name" class="text-sm font-medium">Name</label>
        <input
          id="edit-group-name"
          v-model="editForm.name"
          type="text"
          required
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <label for="edit-group-desc" class="text-sm font-medium">Description</label>
        <textarea
          id="edit-group-desc"
          v-model="editForm.description"
          rows="3"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <p v-if="editError" role="alert" class="text-xs text-destructive">{{ editError }}</p>
    </form>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          @click="isEditingOpen = false"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          type="button"
        >
          Cancel
        </button>
        <button
          @click="saveEdit"
          :disabled="saving || !editForm.name.trim()"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          type="button"
        >
          {{ saving ? 'Saving…' : 'Save Changes' }}
        </button>
      </div>
    </template>
  </Modal>

  <Modal v-model="isDeleteOpen" title="Delete Group" size="sm" @close="isDeleteOpen = false">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted-foreground">
        This will permanently delete the group
        <strong class="text-foreground">{{ deletingGroup?.name }}</strong>.
        Members will lose access to agents owned by this group.
      </p>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          @click="isDeleteOpen = false"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          type="button"
        >
          Cancel
        </button>
        <button
          @click="confirmDelete"
          :disabled="saving"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-destructive px-4 text-sm font-medium text-destructive-foreground shadow transition-colors hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
          type="button"
        >
          {{ saving ? 'Deleting…' : 'Delete Group' }}
        </button>
      </div>
    </template>
  </Modal>
</template>
