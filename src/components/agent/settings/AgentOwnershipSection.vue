<script setup lang="ts">
/**
 * AgentOwnershipSection — surface the agent's current owner and offer a
 * Transfer dialog so the caller can move a user-owned agent into one of
 * their groups, or vice-versa. Sits between Tools and Danger Zone on the
 * Agent Settings page.
 *
 * The dialog's options come from `usePrincipalsStore` — the same
 * `GET /principals/me` source the Group page's Transfer dialog uses.
 * Server-side role filtering means anything returned is fair game
 * (the user owns/admin of any group in the list; their own user-principal
 * is the only user-principal returned). We exclude the current owner so
 * the dropdown never offers a no-op transfer.
 *
 * The transfer call goes through `POST /api/v1/agents/{id}/transfer`,
 * which authorises caller-control of both source and target principal
 * server-side. On success we refresh the agent so the OwnerBadge
 * re-resolves against the new principal.
 */
import { computed, onMounted, ref } from 'vue'
import { useAgentStore } from '@/stores/agent'
import { useAuthStore } from '@/stores/auth'
import { usePrincipalsStore } from '@/stores/principals'
import { useToast } from '@/composables/useToast'
import { api, ApiError } from '@/api/client'
import OwnerBadge from '@/components/agent/OwnerBadge.vue'
import Modal from '@/components/Modal.vue'
import type { Agent } from '@/types/agent'
import type { Principal } from '@/types/principal'

const props = defineProps<{
  agent: Agent
}>()

const agentStore = useAgentStore()
const authStore = useAuthStore()
const principalsStore = usePrincipalsStore()
const toast = useToast()

onMounted(() => {
  if (principalsStore.principals.length === 0) {
    void principalsStore.load()
  }
})

const currentPrincipalId = computed<number | null>(() => props.agent.principal?.id ?? null)

const showTransfer = ref(false)
const transferTargetPrincipalId = ref<number | null>(null)
const transferring = ref(false)
const transferError = ref<string | null>(null)

/** Principals the caller can transfer TO — every group they belong to
 *  plus their own user-principal, with the current owner excluded so
 *  the dropdown never offers a no-op. Server-side filtering on
 *  `/principals/me` already constrains the list to what the caller
 *  controls, so no further role check is needed client-side. */
const transferOptions = computed<Principal[]>(() => {
  const callerId = authStore.user?.id
  return principalsStore.principals
    .filter((p) => {
      if (p.type === 'group') return true
      return p.user_id !== undefined && p.user_id === callerId
    })
    .filter((p) => p.id !== currentPrincipalId.value)
})

function principalLabel(p: Principal): string {
  if (p.type === 'group') return `Group · ${p.name}`
  return `You (${p.name})`
}

function openTransfer(): void {
  transferTargetPrincipalId.value = null
  transferError.value = null
  showTransfer.value = true
}

async function performTransfer(): Promise<void> {
  if (transferTargetPrincipalId.value === null) return
  transferring.value = true
  transferError.value = null
  try {
    await api.post(`/agents/${props.agent.id}/transfer`, {
      principal_id: transferTargetPrincipalId.value,
    })
    showTransfer.value = false
    toast.success('Agent ownership transferred.')
    // Re-fetch so the OwnerBadge (bound to the parent's currentAgent)
    // re-resolves against the new principal in the same session.
    await agentStore.fetchAgent(props.agent.id)
  } catch (e) {
    transferError.value = e instanceof ApiError ? e.message : 'Failed to transfer agent.'
  } finally {
    transferring.value = false
  }
}
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
    <header class="flex items-start justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold">Ownership</h2>
        <p class="text-sm text-muted-foreground mt-1">
          Transfer this agent to a different principal. Group-owned agents can be
          run by any member of the group; user-owned agents are private to you.
        </p>
      </div>
      <button
        v-if="transferOptions.length > 0"
        type="button"
        data-testid="open-transfer-dialog"
        class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted transition-colors shrink-0"
        @click="openTransfer"
      >
        Transfer ownership
      </button>
    </header>

    <div class="flex items-center gap-2 text-sm">
      <span class="text-muted-foreground">Current owner:</span>
      <OwnerBadge :agent="agent" />
    </div>

    <Modal
      v-model="showTransfer"
      title="Transfer ownership"
      size="sm"
      :backdrop-closable="!transferring"
    >
      <div class="flex flex-col gap-3">
        <p class="text-sm text-muted-foreground">
          Transfer <strong class="text-foreground">{{ agent.name }}</strong>
          to a different principal. The new owner must be one you control.
        </p>
        <label for="agent-transfer-target" class="text-sm font-medium">New owner</label>
        <select
          id="agent-transfer-target"
          v-model.number="transferTargetPrincipalId"
          data-testid="transfer-target"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option :value="null">— Select a principal —</option>
          <option v-for="option in transferOptions" :key="option.id" :value="option.id">
            {{ principalLabel(option) }}
          </option>
        </select>
        <p v-if="transferError" role="alert" data-testid="transfer-error" class="text-xs text-destructive">
          {{ transferError }}
        </p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            :disabled="transferring"
            class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            @click="showTransfer = false"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="confirm-transfer"
            :disabled="transferring || transferTargetPrincipalId === null"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
            @click="performTransfer"
          >
            {{ transferring ? 'Transferring…' : 'Transfer' }}
          </button>
        </div>
      </template>
    </Modal>
  </section>
</template>
