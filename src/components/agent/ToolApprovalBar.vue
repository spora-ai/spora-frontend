<script setup lang="ts">
import { ref, computed, useId, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import ToolApprovalCard from '@/components/agent/ToolApprovalCard.vue'
import { pruneEditedArgs, REJECT_ALL_DEFAULT_REASON } from '@/composables/useToolApproval'
import type { Decision } from '@/composables/useTaskChatApprovals'
import type { ToolCall } from '@/types/task'

const props = defineProps<{
  pending: ToolCall[]
  approveError?: string | null
  submitting?: boolean
  rejecting?: boolean
}>()

const emit = defineEmits<{
  'submit-decisions': [payload: { decisions: Decision[] }]
  'reject-all': [payload: { reason: string }]
}>()

const showRejectInput = ref(false)
const rejectReason = ref('')
const rejectAllReasonId = useId()
const editedArgs = ref<Record<string, Record<string, unknown>>>({})
const decisions = ref<Record<number, 'approved' | 'rejected'>>({})
const rejectReasons = ref<Record<number, string>>({})

const approvedCount = computed(() => props.pending.filter(tc => decisions.value[tc.id] === 'approved').length)
const rejectedCount = computed(() => props.pending.filter(tc => decisions.value[tc.id] === 'rejected').length)
const decidedCount = approvedCount
const allDecided = computed(() => props.pending.length > 0 && props.pending.every(tc => decisions.value[tc.id] !== undefined))
const undecidedCount = computed(() => props.pending.length - approvedCount.value - rejectedCount.value)
const submitLabel = computed(() => {
  if (props.submitting) return 'Submitting…'
  if (allDecided.value) return props.pending.length === 1 ? '✓ Submit Decision' : '✓ Submit Decisions'
  return [
    undecidedCount.value > 0 ? `${undecidedCount.value} to decide` : '',
    approvedCount.value > 0 ? `${approvedCount.value} to approve` : '',
    rejectedCount.value > 0 ? `${rejectedCount.value} rejected` : '',
  ].filter(Boolean).join(', ')
})

watch(() => props.pending.map(tc => tc.provider_call_id), (ids) => {
  editedArgs.value = pruneEditedArgs(editedArgs.value, ids)
})

watch(() => props.pending.map(tc => tc.id), (ids) => {
  for (const id of Object.keys(decisions.value)) {
    if (!ids.includes(Number(id))) delete decisions.value[Number(id)]
  }
  for (const id of Object.keys(rejectReasons.value)) {
    if (!ids.includes(Number(id))) delete rejectReasons.value[Number(id)]
  }
})

function onCardArgumentsUpdated(payload: { providerCallId: string; arguments: Record<string, unknown> }): void {
  editedArgs.value[payload.providerCallId] = payload.arguments
}

function onCardDecidedChanged(payload: { cardId: number; providerCallId: string; decided: boolean }): void {
  if (payload.decided) decisions.value[payload.cardId] = 'approved'
  else if (decisions.value[payload.cardId] === 'approved') delete decisions.value[payload.cardId]
}

function onCardRejectedChanged(payload: { cardId: number; providerCallId: string; rejected: boolean }): void {
  if (payload.rejected) decisions.value[payload.cardId] = 'rejected'
  else if (decisions.value[payload.cardId] === 'rejected') {
    delete decisions.value[payload.cardId]
    delete rejectReasons.value[payload.cardId]
  }
}

function onCardReasonChanged(payload: { cardId: number; reason: string }): void {
  rejectReasons.value[payload.cardId] = payload.reason
}

function approveAllRemaining(): void {
  for (const tc of props.pending) {
    if (decisions.value[tc.id] === undefined) decisions.value[tc.id] = 'approved'
  }
}

function onSubmit(): void {
  emit('submit-decisions', {
    decisions: props.pending.map((tc) => {
      if (decisions.value[tc.id] === 'approved') {
        return {
          providerCallId: tc.provider_call_id,
          decision: 'approve',
          arguments: editedArgs.value[tc.provider_call_id] ?? {},
        }
      }
      const reason = rejectReasons.value[tc.id]?.trim()
      return {
        providerCallId: tc.provider_call_id,
        decision: 'reject',
        reason: reason && reason.length > 0 ? reason : 'User rejected',
      }
    }),
  })
}

function onRejectAllConfirm(): void {
  emit('reject-all', { reason: rejectReason.value || REJECT_ALL_DEFAULT_REASON })
  rejectReason.value = ''
  showRejectInput.value = false
}

function onRejectAllCancel(): void {
  showRejectInput.value = false
  rejectReason.value = ''
}
</script>

<template>
  <div class="border-t border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 shrink-0 sticky top-0 z-10">
    <div class="max-w-2xl w-full mx-auto px-4 py-4 flex flex-col gap-4">
      <div class="flex items-center justify-between gap-3">
        <button
          v-if="pending.length > 1 && undecidedCount > 0"
          data-test="approval-approve-all"
          @click="approveAllRemaining"
          class="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white dark:bg-zinc-900 px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          type="button"
        >
          ✓ Approve all remaining
        </button>
        <div class="flex items-center gap-2 min-w-0">
          <Icon name="warning" class="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span class="text-sm font-semibold text-amber-800 dark:text-amber-200 truncate">
            {{ pending.length === 1 ? 'Tool approval required' : `${pending.length} tool approvals required` }}
          </span>
          <span v-if="pending.length > 1" class="text-xs text-muted-foreground tabular-nums" data-test="approval-progress">
            {{ decidedCount }} of {{ pending.length }} decided
          </span>
        </div>
        <div v-if="pending.length > 1" class="flex gap-2 shrink-0">
          <button
            v-if="!showRejectInput"
            :disabled="rejecting"
            data-test="approval-reject-all"
            @click="showRejectInput = true"
            class="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-white dark:bg-zinc-900 px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
            type="button"
          >
            {{ rejecting ? 'Rejecting…' : '✗ Reject All' }}
          </button>
          <template v-else>
            <button :disabled="rejecting" data-test="approval-reject-confirm" @click="onRejectAllConfirm" class="inline-flex h-8 items-center justify-center rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-100 transition-colors disabled:pointer-events-none disabled:opacity-50" type="button">
              {{ rejecting ? 'Rejecting…' : 'Confirm Reject All' }}
            </button>
            <button :disabled="rejecting" data-test="approval-reject-cancel" @click="onRejectAllCancel" class="inline-flex h-8 items-center justify-center rounded-lg border border-border px-3 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50" type="button">
              Cancel
            </button>
          </template>
        </div>
      </div>

      <div v-if="showRejectInput" class="flex flex-col gap-1.5">
        <label :for="rejectAllReasonId" class="text-xs font-medium text-muted-foreground">Reason for rejecting all tools</label>
        <input :id="rejectAllReasonId" v-model="rejectReason" type="text" placeholder="Explain why you're rejecting all actions…" class="w-full rounded-lg border border-border bg-white dark:bg-zinc-900 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
      </div>

      <p v-if="approveError" role="alert" class="text-xs text-destructive">{{ approveError }}</p>

      <ToolApprovalCard
        v-for="tc in pending"
        :key="tc.id"
        :tool-call="tc"
        :submitting="submitting"
        :decided="decisions[tc.id] === 'approved'"
        :rejected="decisions[tc.id] === 'rejected'"
        :reason="rejectReasons[tc.id] ?? ''"
        @update:decided="onCardDecidedChanged"
        @update:rejected="onCardRejectedChanged"
        @update:reason="onCardReasonChanged"
        @update:arguments="onCardArgumentsUpdated"
      />

      <div v-if="pending.length >= 1" class="flex justify-end">
        <button @click="onSubmit" :disabled="!allDecided || submitting" class="inline-flex h-9 items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 text-white text-sm font-medium shadow transition-colors disabled:pointer-events-none disabled:opacity-50" data-test="approval-submit" type="button">
          {{ submitLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
