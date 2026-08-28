<script setup lang="ts">
/**
 * GroupAgentsPage — table of agents owned by the group with row-level
 * Open (→ /agents/:id) and Transfer (move ownership to another principal).
 *
 * The Transfer dialog picks a target via a principal typeahead populated by
 * `GET /principals/me` rather than asking the caller to type an opaque
 * principal id — the same dropdown the CreateAgentDialog owner step uses.
 *
 * The page header exposes a "+ New agent" CTA that opens the global
 * CreateAgentDialog with the group's `principal_id` pre-selected, so the
 * wizard skips its 'Pick an owner' step and the new agent lands in this
 * group on submit.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { usePrincipalsStore } from '@/stores/principals'
import { useAuthStore } from '@/stores/auth'
import { useCreateAgentDialogStore } from '@/stores/createAgentDialog'
import { useToast } from '@/composables/useToast'
import { api, ApiError } from '@/api/client'
import Modal from '@/components/Modal.vue'
import Icon from '@/components/ui/Icon.vue'
import type { Principal } from '@/types/principal'

interface AgentRow {
  id: number
  name: string
  created_at?: string
}

const detailStore = useGroupDetailStore()
const principalsStore = usePrincipalsStore()
const authStore = useAuthStore()
const createDialog = useCreateAgentDialogStore()
const toast = useToast()
const router = useRouter()

const groupId = computed<number>(() => detailStore.group?.id ?? 0)

onMounted(async () => {
  if (groupId.value === 0) return
  try {
    await Promise.all([
      detailStore.fetchAgents(groupId.value),
      principalsStore.principals.length === 0 ? principalsStore.load() : Promise.resolve(),
    ])
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to load agents.')
  }
})

const showTransfer = ref(false)
const transferringAgent = ref<AgentRow | null>(null)
const transferTargetPrincipalId = ref<number | null>(null)
const transferring = ref(false)
const transferError = ref<string | null>(null)

const principalOptions = computed<Principal[]>(() => {
  const groupPrincipalId = detailStore.group?.principal_id
  const callerId = authStore.user?.id
  return principalsStore.principals.filter((p) => {
    if (p.type === 'group') return true
    return p.user_id !== undefined && p.user_id === callerId
  }).filter((p) => p.id !== groupPrincipalId)
})

function principalLabel(p: Principal): string {
  if (p.type === 'group') return `Group · ${p.name}`
  return `You (${p.name})`
}

function openTransfer(agent: AgentRow): void {
  transferringAgent.value = agent
  transferTargetPrincipalId.value = null
  transferError.value = null
  showTransfer.value = true
}

async function performTransfer(): Promise<void> {
  if (transferringAgent.value === null || transferTargetPrincipalId.value === null) return
  transferring.value = true
  transferError.value = null
  try {
    await api.post(`/agents/${transferringAgent.value.id}/transfer`, {
      principal_id: transferTargetPrincipalId.value,
    })
    toast.success('Agent transferred.')
    showTransfer.value = false
    transferringAgent.value = null
    if (groupId.value > 0) {
      await detailStore.fetchAgents(groupId.value)
    }
  } catch (e) {
    transferError.value = e instanceof ApiError ? e.message : 'Failed to transfer agent.'
  } finally {
    transferring.value = false
  }
}

function openAgent(agentId: number): void {
  void router.push({ name: 'agent', params: { id: String(agentId) } })
}

function onNewAgent(): void {
  const pid = detailStore.group?.principal_id
  if (pid === undefined) return
  createDialog.open('choice', pid)
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold">Agents</h1>
        <p class="text-sm text-muted-foreground mt-0.5">
          Agents owned by this group. Transfer moves ownership to a different principal.
        </p>
      </div>
      <button
        v-if="groupId > 0 && detailStore.group?.principal_id !== undefined"
        type="button"
        class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 shrink-0"
        @click="onNewAgent"
      >
        <Icon name="plus" class="h-4 w-4 mr-1" />
        New agent
      </button>
    </div>

    <div class="rounded-xl border border-border overflow-x-scroll">
      <table class="w-full text-sm">
        <thead class="bg-muted/40">
          <tr>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
            <th class="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="agent in detailStore.agents" :key="agent.id">
            <td class="px-4 py-3 font-medium">
              <button
                type="button"
                @click="openAgent(agent.id)"
                class="text-primary hover:underline focus:outline-none focus:underline"
              >
                {{ agent.name }}
              </button>
            </td>
            <td class="px-4 py-3 text-muted-foreground">{{ formatDate(agent.created_at) }}</td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-1 justify-end">
                <button
                  type="button"
                  @click="openAgent(agent.id)"
                  class="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                  title="Open agent"
                >
                  Open
                </button>
                <button
                  type="button"
                  @click="openTransfer(agent)"
                  class="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <Icon name="arrow-right" class="h-3.5 w-3.5 mr-1" />
                  Transfer
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="detailStore.agents.length === 0">
            <td colspan="3" class="px-4 py-8 text-center text-muted-foreground">
              No agents owned by this group yet.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-model="showTransfer" title="Transfer agent" size="sm" :backdrop-closable="!transferring">
      <div class="flex flex-col gap-3">
        <p class="text-sm text-muted-foreground">
          Transfer <strong class="text-foreground">{{ transferringAgent?.name }}</strong>
          to a different principal. Agents with pending tasks will be rejected.
        </p>
        <label for="agent-transfer-target" class="text-sm font-medium">Target principal</label>
        <select
          id="agent-transfer-target"
          v-model.number="transferTargetPrincipalId"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option :value="null">— Select a principal —</option>
          <option v-for="option in principalOptions" :key="option.id" :value="option.id">
            {{ principalLabel(option) }}
          </option>
        </select>
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
            :disabled="transferring || transferTargetPrincipalId === null"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {{ transferring ? 'Transferring…' : 'Transfer' }}
          </button>
        </div>
      </template>
    </Modal>
  </div>
</template>
