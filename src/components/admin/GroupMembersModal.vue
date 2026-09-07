<script setup lang="ts">
/**
 * GroupMembersModal — admin-panel overlay for listing and mutating the
 * members of any group. Opened from the per-row "Manage members" button
 * on `/settings/admin/groups`. The overlay is the only path non-member
 * admins have onto a group's internals since the detail page was
 * hidden from them — the GroupMemberController endpoints keep their
 * admin bypass for exactly this reason.
 *
 * State resets on close so reopening for a different group doesn't
 * flash the previous list. Self-remove is hidden on the caller's own
 * row as defence in depth; `GroupService::removeMember` would 409
 * the call anyway.
 */
import { ref, watch, computed } from 'vue'
import Modal from '@/components/Modal.vue'
import Icon from '@/components/ui/Icon.vue'
import { useGroupsStore } from '@/stores/groups'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { ApiError } from '@/api/client'
import type { Group, GroupMember } from '@/types/principal'

const props = defineProps<{
  group: Group | null
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const groupsStore = useGroupsStore()
const authStore = useAuthStore()
const toast = useToast()
const { confirm } = useConfirmDialog()

const members = ref<GroupMember[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const addEmail = ref('')
const addRole = ref<'owner' | 'admin' | 'member'>('member')
const adding = ref(false)
const addError = ref<string | null>(null)

const canSubmitAdd = computed<boolean>(() => {
  const trimmed = addEmail.value.trim()
  const at = trimmed.indexOf('@')
  if (at <= 0 || at === trimmed.length - 1) return false
  const domain = trimmed.slice(at + 1)
  return domain.length > 0 && domain.includes('.') && !/\s/.test(trimmed)
})

const currentUserId = computed<number | null>(() => authStore.user?.id ?? null)

async function loadMembers(): Promise<void> {
  if (!props.group) return
  loading.value = true
  loadError.value = null
  try {
    members.value = await groupsStore.fetchMembers(props.group.id)
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : 'Failed to load members.'
  } finally {
    loading.value = false
  }
}

function resetState(): void {
  members.value = []
  loadError.value = null
  addEmail.value = ''
  addRole.value = 'member'
  addError.value = null
  adding.value = false
}

watch(() => props.modelValue, (open) => {
  if (open) {
    resetState()
    void loadMembers()
  } else {
    resetState()
  }
}, { immediate: true })

watch(() => props.group, (next) => {
  if (props.modelValue && next) {
    void loadMembers()
  }
})

async function submitAdd(): Promise<void> {
  if (!props.group || !canSubmitAdd.value) return
  adding.value = true
  addError.value = null
  try {
    const member = await groupsStore.addMember(
      props.group.id,
      { email: addEmail.value.trim() },
      addRole.value,
    )
    members.value = [...members.value, member]
    addEmail.value = ''
    addRole.value = 'member'
    toast.success('Member added.')
  } catch (e) {
    if (e instanceof ApiError && e.code === 'ROLE_RULE_VIOLATION') {
      addError.value = e.message
    } else {
      addError.value = e instanceof ApiError ? e.message : 'Failed to add member.'
    }
  } finally {
    adding.value = false
  }
}

async function changeRole(member: GroupMember, role: string): Promise<void> {
  if (!props.group) return
  try {
    const updated = await groupsStore.updateMember(props.group.id, member.user_id, role)
    members.value = members.value.map((m) => (m.user_id === member.user_id ? updated : m))
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to update role.')
  }
}

async function removeMember(member: GroupMember): Promise<void> {
  if (!props.group) return
  const ok = await confirm(
    `Remove ${displayName(member)} from this group? They will lose access to the group's agents and settings.`,
    'Remove member',
    'Remove',
  )
  if (!ok) return
  try {
    await groupsStore.removeMember(props.group.id, member.user_id)
    members.value = members.value.filter((m) => m.user_id !== member.user_id)
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

function isSelf(member: GroupMember): boolean {
  return currentUserId.value !== null && member.user_id === currentUserId.value
}

function onBackdropClick(): void {
  if (!adding.value) emit('update:modelValue', false)
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="`${group?.name ?? 'Group'} — Members`"
    size="lg"
    :backdrop-closable="!adding"
    @update:model-value="emit('update:modelValue', $event)"
    @close="onBackdropClick"
  >
    <div v-if="loading && members.length === 0" class="flex items-center justify-center py-8 text-sm text-muted-foreground">
      Loading…
    </div>

    <div v-else-if="loadError" class="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      {{ loadError }}
    </div>

    <div v-else class="flex flex-col gap-4">
      <div class="rounded-xl border border-border overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-muted/40">
            <tr>
              <th class="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
              <th class="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
              <th class="px-4 py-3 w-12" />
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="member in members" :key="member.user_id" :data-testid="`member-row-${member.user_id}`">
              <td class="px-4 py-3">
                <div class="flex flex-col">
                  <span class="font-medium">{{ displayName(member) }}</span>
                  <span v-if="member.email && member.name" class="text-xs text-muted-foreground">{{ member.email }}</span>
                </div>
              </td>
              <td class="px-4 py-3">
                <label :for="`gm-role-${member.user_id}`" class="sr-only">Role</label>
                <select
                  :id="`gm-role-${member.user_id}`"
                  :value="member.role"
                  :data-testid="`member-role-${member.user_id}`"
                  @change="(e) => changeRole(member, (e.target as HTMLSelectElement).value)"
                  class="rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              </td>
              <td class="px-4 py-3">
                <button
                  v-if="!isSelf(member)"
                  @click="removeMember(member)"
                  :data-testid="`member-remove-${member.user_id}`"
                  title="Remove from group"
                  class="flex items-center justify-center h-7 w-7 rounded-lg text-foreground hover:text-destructive hover:bg-destructive/10 transition-colors ml-auto"
                  type="button"
                >
                  <Icon name="trash" class="h-4 w-4" />
                </button>
              </td>
            </tr>
            <tr v-if="members.length === 0">
              <td colspan="3" class="px-4 py-8 text-center text-muted-foreground">
                No members yet.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex flex-col gap-3 border-t border-border pt-4">
        <h2 class="text-sm font-medium">Add member</h2>
        <div class="flex flex-col gap-1.5">
          <label for="gm-add-email" class="text-xs font-medium text-muted-foreground">Email</label>
          <div class="flex items-center gap-2">
            <input
              id="gm-add-email"
              v-model="addEmail"
              type="email"
              inputmode="email"
              autocomplete="email"
              placeholder="alice@example.com"
              :disabled="adding"
              class="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <label for="gm-add-role" class="sr-only">Role</label>
            <select
              id="gm-add-role"
              v-model="addRole"
              :disabled="adding"
              class="rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="gm-add-role"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
            <button
              @click="submitAdd"
              :disabled="adding || !canSubmitAdd"
              data-testid="gm-add-submit"
              class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
              type="button"
            >
              {{ adding ? 'Adding…' : 'Add' }}
            </button>
          </div>
          <p v-if="addError" role="alert" class="text-xs text-destructive">{{ addError }}</p>
        </div>
      </div>
    </div>
  </Modal>
</template>
