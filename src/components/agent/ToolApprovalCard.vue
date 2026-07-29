<script setup lang="ts">
import { ref, computed, watch, useId } from 'vue'
import ToolArgumentsEditor from '@/components/agent/ToolArgumentsEditor.vue'
import { tryParseArgsObject, normalizeProposedArgs, prettyPrintArgs } from '@/composables/useToolApproval'
import type { ToolCall } from '@/types/task'

const props = defineProps<{
  toolCall: ToolCall
  decided?: boolean
  rejected?: boolean
  reason?: string
  submitting?: boolean
}>()

const emit = defineEmits<{
  'update:decided': [payload: { cardId: number; providerCallId: string; decided: boolean }]
  'update:rejected': [payload: { cardId: number; providerCallId: string; rejected: boolean }]
  'update:reason': [payload: { cardId: number; reason: string }]
  'update:arguments': [payload: { providerCallId: string; arguments: Record<string, unknown> }]
}>()

const argsJson = ref('')
const reasonInput = ref(props.reason ?? '')
const rejectReasonId = useId()
const parsedProposedArgs = computed<Record<string, unknown>>(() => normalizeProposedArgs(props.toolCall.proposed_arguments))
const identity = computed(() => ({ cardId: props.toolCall.id, providerCallId: props.toolCall.provider_call_id }))

watch(() => props.reason, (incoming) => {
  if ((incoming ?? '') !== reasonInput.value) reasonInput.value = incoming ?? ''
})

function emitCurrentArgs(): void {
  const parsed = tryParseArgsObject(argsJson.value)
  if (parsed === null) return
  emit('update:arguments', { providerCallId: props.toolCall.provider_call_id, arguments: parsed })
}

watch(() => props.toolCall.id, () => {
  argsJson.value = prettyPrintArgs(parsedProposedArgs.value)
  emitCurrentArgs()
}, { immediate: true })

function onArgumentsUpdated(json: string): void {
  argsJson.value = json
  emitCurrentArgs()
}

function onApproveClick(): void {
  if (props.decided) {
    emit('update:decided', { ...identity.value, decided: false })
    return
  }
  const parsed = tryParseArgsObject(argsJson.value)
  if (parsed === null) return
  emit('update:arguments', { providerCallId: props.toolCall.provider_call_id, arguments: parsed })
  if (props.rejected) emit('update:rejected', { ...identity.value, rejected: false })
  emit('update:decided', { ...identity.value, decided: true })
}

function onRejectClick(): void {
  if (props.rejected) {
    emit('update:rejected', { ...identity.value, rejected: false })
    return
  }
  if (props.decided) emit('update:decided', { ...identity.value, decided: false })
  emit('update:rejected', { ...identity.value, rejected: true })
}

function onReasonInput(e: Event): void {
  const value = (e.target as HTMLInputElement).value
  reasonInput.value = value
  emit('update:reason', { cardId: props.toolCall.id, reason: value })
}
</script>

<template>
  <div
    class="rounded-xl border bg-white dark:bg-zinc-900 p-4 flex flex-col gap-3"
    :class="decided
      ? 'border-emerald-300 dark:border-emerald-700'
      : rejected
        ? 'border-red-300 dark:border-red-700'
        : 'border-amber-200 dark:border-amber-800'"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <p class="text-sm font-semibold font-mono" :class="decided ? 'text-emerald-900 dark:text-emerald-100' : rejected ? 'text-red-900 dark:text-red-100' : 'text-amber-900 dark:text-amber-100'">
            {{ toolCall.tool_name }}
          </p>
          <span v-if="toolCall.operation && toolCall.operation !== 'default'" class="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
            {{ toolCall.operation }}
          </span>
          <span v-if="decided" class="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">✓ Approved</span>
          <span v-if="rejected" class="inline-flex items-center rounded-full bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">✓ Rejected</span>
        </div>
        <p v-if="toolCall.operation_description" class="text-xs text-muted-foreground mt-0.5">{{ toolCall.operation_description }}</p>
        <p v-else-if="toolCall.human_description" class="text-xs text-muted-foreground mt-0.5">{{ toolCall.human_description }}</p>
      </div>
    </div>

    <ToolArgumentsEditor
      :arguments="toolCall.proposed_arguments"
      :tool-name="toolCall.tool_name"
      :operation="toolCall.operation"
      :parameter-schema="toolCall.parameter_schema ?? null"
      @update:arguments="onArgumentsUpdated"
    />

    <div class="flex gap-2">
      <button
        @click="onApproveClick"
        :disabled="submitting"
        :class="decided
          ? 'border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
          : 'bg-amber-600 hover:bg-amber-700 text-white shadow'"
        class="inline-flex h-8 flex-1 items-center justify-center rounded-lg px-3 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
        type="button"
      >
        {{ decided ? '✓ Approved — Undo' : '✓ Approve' }}
      </button>
      <button
        @click="onRejectClick"
        :disabled="submitting"
        :class="rejected
          ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 hover:bg-red-100'
          : 'border-red-300 dark:border-red-800 bg-white dark:bg-zinc-900 text-muted-foreground hover:text-red-700 dark:hover:text-red-300'"
        class="inline-flex h-8 flex-1 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
        type="button"
      >
        {{ rejected ? '✗ Rejected — Undo' : '✗ Reject' }}
      </button>
    </div>

    <div v-if="rejected" class="flex flex-col gap-1">
      <label :for="rejectReasonId" class="text-xs font-medium text-muted-foreground">Reason (optional)</label>
      <input
        :id="rejectReasonId"
        :value="reasonInput"
        @input="onReasonInput"
        type="text"
        placeholder="Why are you rejecting this tool?"
        data-test="approval-reason-input"
        class="w-full rounded-lg border border-border bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  </div>
</template>
