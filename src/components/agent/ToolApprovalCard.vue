<script setup lang="ts">
/**
 * ToolApprovalCard — one per pending tool call. Each card carries a local
 * "decided" state (green = approved locally) the bar reads to gate its
 * Submit button. Reject is one-shot at the bar level only — per-card
 * reject used to reject everything and isn't a supported mode.
 */
import { ref, computed, watch } from 'vue'
import ToolArgumentsEditor from '@/components/agent/ToolArgumentsEditor.vue'
import {
  tryParseArgsObject,
  normalizeProposedArgs,
  prettyPrintArgs,
} from '@/composables/useToolApproval'
import type { ToolCall } from '@/types/task'

const props = defineProps<{
  toolCall: ToolCall
  /** Local decision state owned by the bar. When true, the card shows the
   *  Approved/Undo button instead of the Approve button. */
  decided?: boolean
  submitting?: boolean
}>()

const emit = defineEmits<{
  /**
   * Marks the card as approved locally (or false to undo). The bar uses
   * these to decide when Submit becomes enabled. `cardId` is the unique
   * ToolCall.id so two cards sharing a provider_call_id still get
   * independent decision state.
   */
  'update:decided': [payload: { cardId: number; providerCallId: string; decided: boolean }]
  /**
   * Mirrors the `approve` payload but fires on edit rather than on click,
   * so the bar can keep its snapshot in sync with what the card shows.
   */
  'update:arguments': [payload: { providerCallId: string; arguments: Record<string, unknown> }]
}>()

const argsJson = ref('')

const parsedProposedArgs = computed<Record<string, unknown>>(() => {
  return normalizeProposedArgs(props.toolCall.proposed_arguments)
})

function emitCurrentArgs(): void {
  const parsed = tryParseArgsObject(argsJson.value)
  if (parsed === null) return
  emit('update:arguments', { providerCallId: props.toolCall.provider_call_id, arguments: parsed })
}

watch(
  () => props.toolCall.id,
  () => {
    argsJson.value = prettyPrintArgs(parsedProposedArgs.value)
    emitCurrentArgs()
  },
  { immediate: true },
)

function onArgumentsUpdated(json: string): void {
  argsJson.value = json
  emitCurrentArgs()
}

function onApproveClick(): void {
  const parsed = tryParseArgsObject(argsJson.value)
  if (parsed === null) return  // invalid JSON — leave the editor in its current state
  emit('update:arguments', { providerCallId: props.toolCall.provider_call_id, arguments: parsed })
  emit('update:decided', { cardId: props.toolCall.id, providerCallId: props.toolCall.provider_call_id, decided: true })
}

function onUndoClick(): void {
  emit('update:decided', { cardId: props.toolCall.id, providerCallId: props.toolCall.provider_call_id, decided: false })
}
</script>

<template>
  <div
    class="rounded-xl border bg-white dark:bg-zinc-900 p-4 flex flex-col gap-3"
    :class="decided
      ? 'border-emerald-300 dark:border-emerald-700'
      : 'border-amber-200 dark:border-amber-800'"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <p
            class="text-sm font-semibold font-mono"
            :class="decided
              ? 'text-emerald-900 dark:text-emerald-100'
              : 'text-amber-900 dark:text-amber-100'"
          >
            {{ toolCall.tool_name }}
          </p>
          <span
            v-if="toolCall.operation && toolCall.operation !== 'default'"
            class="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
          >
            {{ toolCall.operation }}
          </span>
          <span
            v-if="decided"
            class="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
          >
            ✓ Approved
          </span>
        </div>
        <p
          v-if="toolCall.operation_description"
          class="text-xs text-muted-foreground mt-0.5"
        >
          {{ toolCall.operation_description }}
        </p>
        <p
          v-else-if="toolCall.human_description"
          class="text-xs text-muted-foreground mt-0.5"
        >
          {{ toolCall.human_description }}
        </p>
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
        v-if="!decided"
        @click="onApproveClick"
        :disabled="submitting"
        class="inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium shadow transition-colors disabled:pointer-events-none disabled:opacity-50"
        type="button"
      >
        ✓ Approve
      </button>
      <button
        v-else
        @click="onUndoClick"
        :disabled="submitting"
        class="inline-flex h-8 flex-1 items-center justify-center rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-medium hover:bg-emerald-100 transition-colors disabled:pointer-events-none disabled:opacity-50"
        type="button"
      >
        ✓ Approved — Undo
      </button>
    </div>
  </div>
</template>
