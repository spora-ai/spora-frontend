<script setup lang="ts">
/**
 * GroupMembersPage — list + add + role-edit + remove for a group's members.
 *
 * Edit controls are visible to anyone who isAdmin or whose group role is
 * owner/admin. Member-only callers see a read-only view (the controls
 * are simply not rendered, in addition to the server-side 403).
 */
import { computed, onMounted, ref } from 'vue'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { useGroupsStore } from '@/stores/groups'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { ApiError } from '@/api/client'
import Modal from '@/components/Modal.vue'
import Icon from '@/components/ui/Icon.vue'
import type { GroupMember } from '@/types/principal'

const detailStore = useGroupDetailStore()
const groupsStore = useGroupsStore()
const authStore = useAuthStore()
const toast = useToast()
const { confirm } = useConfirmDialog()

const groupId = computed<number>(() => detailStore.group?.id ?? 0)
const canEdit = computed<boolean>(() => {
  if (authStore.user?.is_admin) return true
  return detailStore.group?.my_role === 'owner' || detailStore.group?.my_role === 'admin'
})

onMounted(async () => {
  if (groupId.value === 0) return
  try {
    await detailStore.fetchMembers(groupId.value)
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to load members.')
  }
})

const showAdd = ref(false)
const addEmail = ref<string>('')
const addRole = ref<'owner' | 'admin' | 'member'>('member')
const adding = ref(false)
const addError = ref<string | null>(null)

const canSubmitAdd = computed<boolean>(() => {
  const trimmed = addEmail.value.trim()
  // Minimal client-side guard — the backend re-validates. We just want
  // the submit button disabled when the field is empty so we don't ship
  // an empty-string email.
  return trimmed.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
})

async function submitAdd(): Promise<void> {
  if (groupId.value === 0 || !canSubmitAdd.value) return
  adding.value = true
  addError.value = null
  try {
    const member = await groupsStore.addMember(
      groupId.value,
      { email: addEmail.value.trim() },
      addRole.value,
    )
    detailStore.members = [...detailStore.members, member]
    if (detailStore.group) {
      detailStore.group = { ...detailStore.group, member_count: (detailStore.group.member_count ?? 0) + 1 }
    }
    toast.success('Member added.')
    showAdd.value = false
    addEmail.value = ''
    addRole.value = 'member'
  } catch (e) {
    addError.value = e instanceof ApiError ? e.message : 'Failed to add member.'
  } finally {
    adding.value = false
  }
}

async function changeRole(member: GroupMember, role: string): Promise<void> {
  if (groupId.value === 0) return
  try {
    const updated = await groupsStore.updateMember(groupId.value, member.user_id, role)
    detailStore.members = detailStore.members.map((m) => (m.user_id === member.user_id ? updated : m))
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to update role.')
  }
}

async function removeMember(member: GroupMember): Promise<void> {
  if (groupId.value === 0) return
  const ok = await confirm(
    `Remove ${displayName(member)} from this group? They will lose access to the group's agents and settings.`,
    'Remove member',
    'Remove',
  )
  if (!ok) return
  try {
    await groupsStore.removeMember(groupId.value, member.user_id)
    detailStore.members = detailStore.members.filter((m) => m.user_id !== member.user_id)
    if (detailStore.group) {
      detailStore.group = {
        ...detailStore.group,
        member_count: Math.max(0, (detailStore.group.member_count ?? 1) - 1),
      }
    }
    toast.success('Member removed.')
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to remove member.')
  }
}

function displayName(member: GroupMember): string {
  if (member.name) return member.name
  if (member.email) return member.email
  return `User #${member.user_id}`
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold">Members</h1>
        <p class="text-sm text-muted-foreground mt-0.5">
          {{ detailStore.members.length }} member{{ detailStore.members.length === 1 ? '' : 's' }}
        </p>
      </div>
      <button
        v-if="canEdit"
        type="button"
        @click="showAdd = true"
        class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
      >
        <Icon name="plus" class="h-4 w-4 mr-1.5" />
        Add Member
      </button>
    </div>

    <div class="rounded-xl border border-border overflow-x-scroll">
      <table class="w-full text-sm">
        <thead class="bg-muted/40">
          <tr>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="member in detailStore.members" :key="member.user_id">
            <td class="px-4 py-3">
              <div class="flex flex-col">
                <span class="font-medium">{{ displayName(member) }}</span>
                <span v-if="member.email && member.name" class="text-xs text-muted-foreground">{{ member.email }}</span>
              </div>
            </td>
            <td class="px-4 py-3">
              <label :for="`role-${member.user_id}`" class="sr-only">Role</label>
              <select
                v-if="canEdit"
                :id="`role-${member.user_id}`"
                :value="member.role"
                @change="(e) => changeRole(member, (e.target as HTMLSelectElement).value)"
                class="rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
              <span v-else class="text-xs rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                {{ member.role }}
              </span>
            </td>
            <td class="px-4 py-3">
              <button
                v-if="canEdit"
                @click="removeMember(member)"
                title="Remove from group"
                class="flex items-center justify-center h-7 w-7 rounded-lg text-foreground hover:text-destructive hover:bg-destructive/10 transition-colors ml-auto"
                type="button"
              >
                <Icon name="trash" class="h-4 w-4" />
              </button>
            </td>
          </tr>
          <tr v-if="detailStore.members.length === 0">
            <td colspan="3" class="px-4 py-8 text-center text-muted-foreground">
              No members yet.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-model="showAdd" title="Add Member" size="sm" :backdrop-closable="!adding">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <label for="add-member-email" class="text-sm font-medium">Email</label>
          <input
            id="add-member-email"
            v-model="addEmail"
            type="email"
            inputmode="email"
            autocomplete="email"
            placeholder="alice@example.com"
            required
            class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <p class="text-xs text-muted-foreground">
            The email must already belong to a Spora user. We resolve it to the matching account server-side.
          </p>
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="add-member-role" class="text-sm font-medium">Role</label>
          <select
            id="add-member-role"
            v-model="addRole"
            class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <p v-if="addError" role="alert" class="text-xs text-destructive">{{ addError }}</p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            @click="showAdd = false"
            :disabled="adding"
            class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            @click="submitAdd"
            :disabled="adding || !canSubmitAdd"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {{ adding ? 'Adding…' : 'Add Member' }}
          </button>
        </div>
      </template>
    </Modal>
  </div>
</template>
