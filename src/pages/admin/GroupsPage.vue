<script setup lang="ts">
/**
 * GroupsPage — admin group management page.
 * Route: /settings/admin/groups
 */
import { ref, computed, onMounted } from 'vue'
import { useGroupsStore } from '@/stores/groups'
import { useUsersStore } from '@/stores/users'
import { ApiError } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useAdminAuth } from '@/composables/useAdminAuth'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminForbidden from '@/components/admin/AdminForbidden.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/Modal.vue'
import type { Group, GroupMember } from '@/types/principal'

const { isAdmin } = useAdminAuth()
const groupsStore = useGroupsStore()
const usersStore = useUsersStore()
const toast = useToast()

const selectedGroup = ref<Group | null>(null)
const selectedGroupMembers = ref<GroupMember[]>([])
const loadingMembers = ref(false)

const isDetailsOpen = computed({
  get: () => selectedGroup.value !== null,
  set: (val: boolean) => { if (!val) selectedGroup.value = null },
})

async function openGroup(group: Group): Promise<void> {
  selectedGroup.value = group
  selectedGroupMembers.value = group.members ?? []
  loadingMembers.value = true
  try {
    selectedGroupMembers.value = await groupsStore.fetchMembers(group.id)
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to load members.')
  } finally {
    loadingMembers.value = false
  }
}

// Create modal

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

// Edit modal

const editingGroup = ref<Group | null>(null)
const isEditingOpen = computed({
  get: () => editingGroup.value !== null,
  set: (val: boolean) => { if (!val) editingGroup.value = null },
})

function openEdit(group: Group): void {
  editingGroup.value = group
  editForm.value = {
    name: group.name,
    description: group.description ?? '',
  }
  editError.value = null
}

const editForm = ref({ name: '', description: '' })
const saving = ref(false)
const editError = ref<string | null>(null)

async function saveEdit(): Promise<void> {
  if (!editingGroup.value) return
  saving.value = true
  editError.value = null
  try {
    const updated = await groupsStore.updateGroup(editingGroup.value.id, {
      name: editForm.value.name,
      description: editForm.value.description || undefined,
    })
    if (selectedGroup.value && selectedGroup.value.id === updated.id) {
      selectedGroup.value = updated
    }
    toast.success('Group updated.')
    isEditingOpen.value = false
  } catch (e) {
    editError.value = e instanceof ApiError ? e.message : 'Failed to update group.'
  } finally {
    saving.value = false
  }
}

// Delete

const deletingGroup = ref<Group | null>(null)
const isDeleteOpen = computed({
  get: () => deletingGroup.value !== null,
  set: (val: boolean) => { if (!val) deletingGroup.value = null },
})

async function confirmDelete(): Promise<void> {
  if (!deletingGroup.value) return
  saving.value = true
  try {
    await groupsStore.deleteGroup(deletingGroup.value.id)
    toast.success('Group deleted.')
    if (selectedGroup.value && selectedGroup.value.id === deletingGroup.value.id) {
      selectedGroup.value = null
    }
    isDeleteOpen.value = false
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to delete group.')
  } finally {
    saving.value = false
  }
}

// Member management

const showAddMember = ref(false)
const addMemberForm = ref<{ user_id: number | null; role: 'owner' | 'admin' | 'member' }>({
  user_id: null,
  role: 'member',
})

onMounted(async () => {
  try {
    await Promise.all([groupsStore.fetchGroups(), usersStore.fetchUsers(1)])
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to load groups.')
  }
})

function openAddMember(): void {
  addMemberForm.value = { user_id: null, role: 'member' }
  showAddMember.value = true
}

async function submitAddMember(): Promise<void> {
  if (!selectedGroup.value || addMemberForm.value.user_id === null) return
  saving.value = true
  try {
    const member = await groupsStore.addMember(
      selectedGroup.value.id,
      addMemberForm.value.user_id,
      addMemberForm.value.role,
    )
    selectedGroupMembers.value = [...selectedGroupMembers.value, member]
    if (selectedGroup.value) {
      selectedGroup.value = {
        ...selectedGroup.value,
        member_count: (selectedGroup.value.member_count ?? 0) + 1,
      }
    }
    toast.success('Member added.')
    showAddMember.value = false
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to add member.')
  } finally {
    saving.value = false
  }
}

async function changeMemberRole(member: GroupMember, role: string): Promise<void> {
  if (!selectedGroup.value) return
  try {
    const updated = await groupsStore.updateMember(
      selectedGroup.value.id,
      member.user_id,
      role,
    )
    const idx = selectedGroupMembers.value.findIndex((m) => m.user_id === member.user_id)
    if (idx !== -1) selectedGroupMembers.value[idx] = updated
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to update role.')
  }
}

async function removeMember(member: GroupMember): Promise<void> {
  if (!selectedGroup.value) return
  try {
    await groupsStore.removeMember(selectedGroup.value.id, member.user_id)
    selectedGroupMembers.value = selectedGroupMembers.value.filter((m) => m.user_id !== member.user_id)
    if (selectedGroup.value) {
      selectedGroup.value = {
        ...selectedGroup.value,
        member_count: Math.max(0, (selectedGroup.value.member_count ?? 1) - 1),
      }
    }
    toast.success('Member removed.')
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to remove member.')
  }
}
</script>

<template>
  <AdminForbidden v-if="!isAdmin" />

  <AdminSection
    v-else
    title="Groups"
    description="Manage RBAC groups for shared agent ownership."
  >
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div />
      <button
        @click="showCreate = true"
        class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        type="button"
      >
        <Icon name="plus" class="h-4 w-4 mr-1.5" />
        Create Group
      </button>
    </div>

    <!-- Loading -->
    <div v-if="groupsStore.loading && groupsStore.groups.length === 0" class="flex items-center justify-center py-12 text-sm text-muted-foreground">
      Loading…
    </div>

    <!-- Error -->
    <div v-else-if="groupsStore.error && groupsStore.groups.length === 0" class="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      {{ groupsStore.error }}
    </div>

    <!-- Table -->
    <div v-else class="rounded-xl border border-border overflow-x-scroll">
      <table class="w-full text-sm">
        <thead class="bg-muted/40">
          <tr>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground">ID</th>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground">Members</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="group in groupsStore.groups" :key="group.id" class="hover:bg-muted/20 transition-colors">
            <td class="px-4 py-3 text-muted-foreground font-mono">{{ group.id }}</td>
            <td class="px-4 py-3 font-medium">{{ group.name }}</td>
            <td class="px-4 py-3 text-muted-foreground">{{ group.description || '—' }}</td>
            <td class="px-4 py-3">{{ group.member_count ?? 0 }}</td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-1 justify-end">
                <button
                  @click="openGroup(group)"
                  title="View members"
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
            <td colspan="5" class="px-4 py-8 text-center text-muted-foreground">No groups found.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </AdminSection>

  <!-- Create Group Modal -->
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

  <!-- Edit Group Modal -->
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

  <!-- Delete Group Modal -->
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

  <!-- Group Details (Members) -->
  <Modal v-model="isDetailsOpen" :title="selectedGroup?.name ?? 'Group'" size="lg" @close="isDetailsOpen = false">
    <div class="flex flex-col gap-4">
      <p v-if="selectedGroup?.description" class="text-sm text-muted-foreground">{{ selectedGroup.description }}</p>

      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium">Members ({{ selectedGroupMembers.length }})</h3>
        <button
          @click="openAddMember"
          class="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          type="button"
        >
          <Icon name="plus" class="h-3.5 w-3.5 mr-1" />
          Add Member
        </button>
      </div>

      <div v-if="loadingMembers" class="text-sm text-muted-foreground py-4 text-center">Loading members…</div>

      <div v-else class="rounded-lg border border-border overflow-x-scroll">
        <table class="w-full text-sm">
          <thead class="bg-muted/40">
            <tr>
              <th class="text-left px-3 py-2 font-medium text-muted-foreground">User</th>
              <th class="text-left px-3 py-2 font-medium text-muted-foreground">Role</th>
              <th class="px-3 py-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="member in selectedGroupMembers" :key="member.user_id">
              <td class="px-3 py-2">
                <div class="flex flex-col">
                  <span class="font-medium">{{ member.name || member.email || `User #${member.user_id}` }}</span>
                  <span v-if="member.email && member.name" class="text-xs text-muted-foreground">{{ member.email }}</span>
                </div>
              </td>
              <td class="px-3 py-2">
                <label :for="`group-member-role-${member.user_id}`" class="sr-only">Role</label>
                <select
                  :id="`group-member-role-${member.user_id}`"
                  :value="member.role"
                  @change="(e) => changeMemberRole(member, (e.target as HTMLSelectElement).value)"
                  class="rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              </td>
              <td class="px-3 py-2">
                <button
                  @click="removeMember(member)"
                  title="Remove from group"
                  class="flex items-center justify-center h-6 w-6 rounded text-foreground hover:text-destructive hover:bg-destructive/10 transition-colors ml-auto"
                  type="button"
                >
                  <Icon name="trash" class="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
            <tr v-if="selectedGroupMembers.length === 0">
              <td colspan="3" class="px-3 py-6 text-center text-muted-foreground text-xs">No members yet.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <button
          @click="isDetailsOpen = false"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          type="button"
        >
          Close
        </button>
      </div>
    </template>
  </Modal>

  <!-- Add Member Modal -->
  <Modal v-model="showAddMember" title="Add Member" size="sm" @close="showAddMember = false">
    <form @submit.prevent="submitAddMember" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <label for="add-member-user" class="text-sm font-medium">User</label>
        <select
          id="add-member-user"
          v-model.number="addMemberForm.user_id"
          required
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option :value="null" disabled>Select user…</option>
          <option v-for="user in usersStore.users" :key="user.id" :value="user.id">
            {{ user.email }}
          </option>
        </select>
      </div>
      <div class="flex flex-col gap-1.5">
        <label for="add-member-role" class="text-sm font-medium">Role</label>
        <select
          id="add-member-role"
          v-model="addMemberForm.role"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          <option value="owner">Owner</option>
        </select>
      </div>
    </form>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          @click="showAddMember = false"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          type="button"
        >
          Cancel
        </button>
        <button
          @click="submitAddMember"
          :disabled="saving || addMemberForm.user_id === null"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          type="button"
        >
          {{ saving ? 'Adding…' : 'Add Member' }}
        </button>
      </div>
    </template>
  </Modal>
</template>