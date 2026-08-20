<script setup lang="ts">
/**
 * GroupAgentsPage — table of agents owned by the group with a Transfer
 * dialog per row.
 *
 * Agents are loaded once on mount via the group's `/agents` endpoint.
 * The transfer dialog posts to `/agents/{id}/transfer` (PR #209 endpoint).
 */
import { computed, onMounted, ref } from 'vue'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { useToast } from '@/composables/useToast'
import { api, ApiError } from '@/api/client'
import Modal from '@/components/Modal.vue'
import Icon from '@/components/ui/Icon.vue'

interface AgentRow {
  id: number
  name: string
  created_at?: string
}

const detailStore = useGroupDetailStore()
const toast = useToast()

const groupId = computed<number>(() => detailStore.group?.id ?? 0)

onMounted(async () => {
  if (groupId.value === 0) return
  try {
    await detailStore.fetchAgents(groupId.value)
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to load agents.')
  }
})

const showTransfer = ref(false)
const transferringAgent = ref<AgentRow | null>(null)
const transferTarget = ref<number | null>(null)
const transferring = ref(false)
const transferError = ref<string | null>(null)

function openTransfer(agent: AgentRow): void {
  transferringAgent.value = agent
  transferTarget.value = null
  transferError.value = null
  showTransfer.value = true
}

async function performTransfer(): Promise<void> {
  if (transferringAgent.value === null || transferTarget.value === null) return
  transferring.value = true
  transferError.value = null
  try {
    await api.post(`/agents/${transferringAgent.value.id}/transfer`, {
      principal_id: transferTarget.value,
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
    <div>
      <h1 class="text-lg font-semibold">Agents</h1>
      <p class="text-sm text-muted-foreground mt-0.5">
        Agents owned by this group. Transfer moves ownership to a different principal.
      </p>
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
            <td class="px-4 py-3 font-medium">{{ agent.name }}</td>
            <td class="px-4 py-3 text-muted-foreground">{{ formatDate(agent.created_at) }}</td>
            <td class="px-4 py-3">
              <button
                type="button"
                @click="openTransfer(agent)"
                class="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors ml-auto"
              >
                <Icon name="arrow-right" class="h-3.5 w-3.5 mr-1" />
                Transfer
              </button>
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
        <label for="agent-transfer-target" class="text-sm font-medium">Target principal ID</label>
        <input
          id="agent-transfer-target"
          v-model.number="transferTarget"
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
            :disabled="transferring || transferTarget === null"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {{ transferring ? 'Transferring…' : 'Transfer' }}
          </button>
        </div>
      </template>
    </Modal>
  </div>
</template>
