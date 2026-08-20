<script setup lang="ts">
/**
 * GroupDangerZone — destructive actions owned by the owner role.
 *
 * Renders nothing when the caller is not an owner. Transfer requires the
 * group to currently own at least one agent (the API would 422 otherwise
 * and the toast is friendlier than the raw error).
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { api, ApiError } from '@/api/client'
import Modal from '@/components/Modal.vue'
import type { Group } from '@/types/principal'

const props = defineProps<{
  group: Group
}>()

const detailStore = useGroupDetailStore()
const authStore = useAuthStore()
const toast = useToast()
const router = useRouter()

const isOwner = computed<boolean>(() => authStore.user?.is_admin === true || props.group.my_role === 'owner')

const showDelete = ref(false)
const showTransfer = ref(false)
const deleting = ref(false)
const transferring = ref(false)
const transferTargetId = ref<number | null>(null)
const transferError = ref<string | null>(null)

const hasAgents = computed<boolean>(() => {
  if (props.group.agent_count !== undefined) return props.group.agent_count > 0
  return detailStore.agents.length > 0
})

async function performDelete(): Promise<void> {
  deleting.value = true
  try {
    await detailStore.deleteGroup(props.group.id)
    toast.success('Group deleted.')
    showDelete.value = false
    router.push({ name: 'settings-admin-groups' })
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to delete group.')
  } finally {
    deleting.value = false
  }
}

async function performTransfer(): Promise<void> {
  if (transferTargetId.value === null) return
  transferring.value = true
  transferError.value = null
  try {
    const targetId = transferTargetId.value
    for (const agent of detailStore.agents) {
      await api.post<{ agent: unknown }>(`/agents/${agent.id}/transfer`, { principal_id: targetId })
    }
    toast.success(`Transferred ${detailStore.agents.length} agent(s).`)
    showTransfer.value = false
    transferTargetId.value = null
    await detailStore.fetchDetail(props.group.id)
  } catch (e) {
    transferError.value = e instanceof ApiError ? e.message : 'Failed to transfer agents.'
  } finally {
    transferring.value = false
  }
}
</script>

<template>
  <div v-if="isOwner" class="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
    <h2 class="text-sm font-semibold text-destructive mb-1">Danger zone</h2>
    <p class="text-xs text-muted-foreground mb-4">
      Destructive actions available to the group's owner. Both actions are irreversible.
    </p>
    <div class="flex flex-col sm:flex-row gap-3">
      <button
        type="button"
        :disabled="!hasAgents"
        @click="showTransfer = true"
        class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        Transfer all agents to…
      </button>
      <button
        type="button"
        @click="showDelete = true"
        class="inline-flex h-9 items-center justify-center rounded-lg bg-destructive px-4 text-sm font-medium text-white shadow transition-colors hover:bg-destructive/90"
      >
        Delete group
      </button>
    </div>
    <p v-if="!hasAgents" class="text-xs text-muted-foreground mt-2">
      Transfer is disabled — this group currently owns no agents.
    </p>
  </div>

  <Modal v-model="showDelete" title="Delete Group" size="sm" :backdrop-closable="!deleting">
    <p class="text-sm text-muted-foreground">
      This will permanently delete
      <strong class="text-foreground">{{ group.name }}</strong>
      and remove every agent, tool setting, and LLM driver it owns. This cannot be undone.
    </p>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          @click="showDelete = false"
          :disabled="deleting"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          @click="performDelete"
          :disabled="deleting"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-destructive px-4 text-sm font-medium text-white shadow transition-colors hover:bg-destructive/90 disabled:opacity-50"
        >
          {{ deleting ? 'Deleting…' : 'Delete Group' }}
        </button>
      </div>
    </template>
  </Modal>

  <Modal v-model="showTransfer" title="Transfer all agents" size="sm" :backdrop-closable="!transferring">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted-foreground">
        Move every agent owned by <strong class="text-foreground">{{ group.name }}</strong>
        to a different principal. Agents with pending tasks will be rejected.
      </p>
      <label for="group-transfer-target" class="text-sm font-medium">Target principal ID</label>
      <input
        id="group-transfer-target"
        v-model.number="transferTargetId"
        type="number"
        min="1"
        placeholder="e.g. 7"
        class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <p v-if="transferError" role="alert" class="text-xs text-destructive">{{ transferError }}</p>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          @click="showTransfer = false"
          :disabled="transferring"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          @click="performTransfer"
          :disabled="transferring || transferTargetId === null"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {{ transferring ? 'Transferring…' : 'Transfer Agents' }}
        </button>
      </div>
    </template>
  </Modal>
</template>
