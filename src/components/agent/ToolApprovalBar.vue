<script setup lang="ts">
/**
 * ToolApprovalBar — sticky bar shown above the chat input when a task is
 * paused waiting for human approval.
 *
 * Each {@see ToolApprovalCard} reports its `decided` state. The bar's
 * "Submit Decisions" button stays disabled until every card has decided.
 * This mirrors the "ask user question" pattern in Claude Code / OpenCode:
 * you cannot submit until you've decided on every question.
 *
 * "Reject All" is a separate one-shot for the bail-out path — it doesn't
 * require per-card decisions.
 */
import { ref, computed, useId, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import ToolApprovalCard from '@/components/agent/ToolApprovalCard.vue'
import {
  buildBulkApprovals,
  pruneEditedArgs,
  REJECT_ALL_DEFAULT_REASON,
} from '@/composables/useToolApproval'
import type { ToolCall } from '@/types/task'

const props = defineProps<{
  pending: ToolCall[]
  approveError?: string | null
  submitting?: boolean
}>()

const emit = defineEmits<{
  'submit-decisions': [payload: { approvals: Array<{ providerCallId: string; arguments: Record<string, unknown> }> }]
  'reject-all': [payload: { reason: string }]
}>()

const showRejectInput = ref(false)
const rejectReason = ref('')
const rejectAllReasonId = useId()

// Snapshot of the most recent arguments each card emitted via update:arguments.
// Keyed by provider_call_id so it survives reordering and prunes naturally
// when a call leaves the pending list.
const editedArgs = ref<Record<string, Record<string, unknown>>>({})

const decisions = ref<Record<string, boolean>>({})

const decidedCount  = computed(() => Object.values(decisions.value).filter(Boolean).length)
const allDecided    = computed(() => decidedCount.value === props.pending.length)
const undecidedCount = computed(() => props.pending.length - decidedCount.value)

watch(
  () => props.pending.map(tc => tc.provider_call_id),
  (ids) => {
    editedArgs.value = pruneEditedArgs(editedArgs.value, ids)
    // Drop decisions for tool calls no longer in the pending set.
    for (const id of Object.keys(decisions.value)) {
      if (!ids.includes(id)) delete decisions.value[id]
    }
  },
)

function onCardArgumentsUpdated(payload: { providerCallId: string; arguments: Record<string, unknown> }): void {
  editedArgs.value[payload.providerCallId] = payload.arguments
}

function onCardDecidedChanged(payload: { providerCallId: string; decided: boolean }): void {
  if (payload.decided) {
    decisions.value[payload.providerCallId] = true
  } else {
    delete decisions.value[payload.providerCallId]
  }
}

function onSubmit(): void {
  const approved = props.pending.filter(tc => decisions.value[tc.provider_call_id])
  const approvals = buildBulkApprovals(approved, editedArgs.value)
  emit('submit-decisions', { approvals })
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
        <div class="flex items-center gap-2 min-w-0">
          <Icon name="warning" class="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span class="text-sm font-semibold text-amber-800 dark:text-amber-200 truncate">
            {{ pending.length === 1 ? 'Tool approval required' : `${pending.length} tool approvals required` }}
          </span>
          <span
            v-if="pending.length > 1"
            class="text-xs text-muted-foreground tabular-nums"
            :data-test="'approval-progress'"
          >
            {{ decidedCount }} of {{ pending.length }} decided
          </span>
        </div>

        <div v-if="pending.length > 1" class="flex gap-2 shrink-0">
          <button
            v-if="!showRejectInput"
            @click="showRejectInput = true"
            class="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-white dark:bg-zinc-900 px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            type="button"
          >
            ✗ Reject All
          </button>
          <template v-else>
            <button
              @click="onRejectAllConfirm"
              class="inline-flex h-8 items-center justify-center rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-100 transition-colors"
              type="button"
            >
              Confirm Reject All
            </button>
            <button
              @click="onRejectAllCancel"
              class="inline-flex h-8 items-center justify-center rounded-lg border border-border px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              type="button"
            >
              Cancel
            </button>
          </template>
        </div>
      </div>

      <div v-if="showRejectInput" class="flex flex-col gap-1.5">
        <label :for="rejectAllReasonId" class="text-xs font-medium text-muted-foreground">Reason for rejecting all tools</label>
        <input
          :id="rejectAllReasonId"
          v-model="rejectReason"
          type="text"
          placeholder="Explain why you're rejecting all actions…"
          class="w-full rounded-lg border border-border bg-white dark:bg-zinc-900 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <p v-if="approveError" role="alert" class="text-xs text-destructive">{{ approveError }}</p>

      <ToolApprovalCard
        v-for="tc in pending"
        :key="tc.id"
        :tool-call="tc"
        :submitting="submitting"
        :decided="decisions[tc.provider_call_id] === true"
        @update:decided="onCardDecidedChanged"
        @update:arguments="onCardArgumentsUpdated"
      />

      <div v-if="pending.length > 1" class="flex justify-end">
        <button
          @click="onSubmit"
          :disabled="!allDecided || submitting"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium shadow transition-colors disabled:pointer-events-none disabled:opacity-50"
          :data-test="'approval-submit'"
          type="button"
        >
          {{
            submitting
              ? 'Submitting…'
              : (undecidedCount === 0
                  ? '✓ Submit Decisions'
                  : `Decide on ${undecidedCount} more`)
          }}
        </button>
      </div>
    </div>
  </div>
</template>
