<script setup lang="ts">
/**
 * GroupDangerZone — destructive actions owned by the owner role.
 *
 * Renders nothing when the caller is not an owner. Transfer requires the
 * group to currently own at least one agent (the API would 422 otherwise
 * and the toast is friendlier than the raw error).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { usePrincipalsStore } from '@/stores/principals'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { api, ApiError } from '@/api/client'
import Modal from '@/components/Modal.vue'
import type { Group, Principal } from '@/types/principal'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  group: Group
}>()

const detailStore = useGroupDetailStore()
const principalsStore = usePrincipalsStore()
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

onMounted(() => {
  if (principalsStore.principals.length === 0) {
    void principalsStore.load().catch(() => {})
  }
})

const transferOptions = computed<Principal[]>(() => {
  const groupPrincipalId = props.group.principal_id
  const callerId = authStore.user?.id
  return principalsStore.principals
    .filter((p) => {
      if (p.type === 'group') return true
      return p.user_id !== undefined && p.user_id === callerId
    })
    .filter((p) => p.id !== groupPrincipalId)
})

function transferOptionLabel(p: Principal): string {
  if (p.type === 'group') return `Group · ${p.name}`
  return `You (${p.name})`
}

async function performDelete(): Promise<void> {
  deleting.value = true
  try {
    await detailStore.deleteGroup(props.group.id)
    toast.success(t('Group deleted.'))
    showDelete.value = false
    // The deleter may be a group owner rather than an admin (the
    // route-level AdminMiddleware was dropped so owners can delete
    // too), so the admin overview isn't a safe landing spot.
    router.push({ name: 'dashboard' })
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('Failed to delete group.'))
  } finally {
    deleting.value = false
  }
}

async function performTransfer(): Promise<void> {
  if (transferTargetId.value === null || transferTargetId.value <= 0) return
  transferring.value = true
  transferError.value = null
  try {
    const targetId = transferTargetId.value
    const total = detailStore.agents.length
    let successCount = 0
    for (const agent of detailStore.agents) {
      try {
        await api.post<{ agent: unknown }>(`/agents/${agent.id}/transfer`, { principal_id: targetId })
        successCount++
      } catch {
        // Continue transferring the remaining agents — the operator
        // gets a single partial-success toast at the end so they can
        // retry the missing ones manually instead of guessing which
        // calls landed.
      }
    }
    if (successCount === total) {
      toast.success(`${t('Transferred')} ${total} ${total === 1 ? t('agent') : t('agents')}.`)
    } else {
      toast.error(`${t('Transferred')} ${successCount} ${t('of')} ${total} ${t('agents.')} ${total - successCount} ${t('failed.')}`)
    }
    showTransfer.value = false
    transferTargetId.value = null
    await detailStore.fetchDetail(props.group.id)
  } catch (e) {
    transferError.value = e instanceof ApiError ? e.message : t('Failed to transfer agents.')
  } finally {
    transferring.value = false
  }
}
</script>

<template>
  <div
    v-if="isOwner"
    class="rounded-xl border border-destructive/30 bg-destructive/5 p-5"
  >
    <h2 class="text-sm font-semibold text-destructive mb-1">
      {{ t('Danger zone') }}
    </h2>
    <p class="text-xs text-muted-foreground mb-4">
      {{ t('Destructive actions available to the group\'s owner. Both actions are irreversible.') }}
    </p>
    <div class="flex flex-col sm:flex-row gap-3">
      <button
        type="button"
        :disabled="!hasAgents"
        @click="showTransfer = true"
        class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {{ t('Transfer all agents to…') }}
      </button>
      <button
        type="button"
        @click="showDelete = true"
        class="inline-flex h-9 items-center justify-center rounded-lg bg-destructive px-4 text-sm font-medium text-white shadow transition-colors hover:bg-destructive/90"
      >
        {{ t('Delete group') }}
      </button>
    </div>
    <p
      v-if="!hasAgents"
      class="text-xs text-muted-foreground mt-2"
    >
      {{ t('Transfer is disabled — this group currently owns no agents.') }}
    </p>
  </div>

  <Modal
    v-model="showDelete"
    :title="t('Delete Group')"
    size="sm"
    :backdrop-closable="!deleting"
  >
    <p class="text-sm text-muted-foreground">
      {{ t('This will permanently delete') }}
      <strong class="text-foreground">{{ group.name }}</strong>
      {{ t('and remove every agent, tool setting, and LLM driver it owns. This cannot be undone.') }}
    </p>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          @click="showDelete = false"
          :disabled="deleting"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {{ t('Cancel') }}
        </button>
        <button
          type="button"
          @click="performDelete"
          :disabled="deleting"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-destructive px-4 text-sm font-medium text-white shadow transition-colors hover:bg-destructive/90 disabled:opacity-50"
        >
          {{ deleting ? t('Deleting…') : t('Delete Group') }}
        </button>
      </div>
    </template>
  </Modal>

  <Modal
    v-model="showTransfer"
    :title="t('Transfer all agents')"
    size="sm"
    :backdrop-closable="!transferring"
  >
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted-foreground">
        {{ t('Move every agent owned by') }} <strong class="text-foreground">{{ group.name }}</strong>
        {{ t('to a different principal. Agents with pending tasks will be rejected.') }}
      </p>
      <label
        for="group-transfer-target"
        class="text-sm font-medium"
      >{{ t('Target principal') }}</label>
      <select
        id="group-transfer-target"
        v-model.number="transferTargetId"
        class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option :value="null">
          {{ t('— Select a principal —') }}
        </option>
        <option
          v-for="option in transferOptions"
          :key="option.id"
          :value="option.id"
        >
          {{ transferOptionLabel(option) }}
        </option>
      </select>
      <p
        v-if="transferError"
        role="alert"
        class="text-xs text-destructive"
      >
        {{ transferError }}
      </p>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          @click="showTransfer = false"
          :disabled="transferring"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {{ t('Cancel') }}
        </button>
        <button
          type="button"
          @click="performTransfer"
          :disabled="transferring || transferTargetId === null"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {{ transferring ? t('Transferring…') : t('Transfer Agents') }}
        </button>
      </div>
    </template>
  </Modal>
</template>
