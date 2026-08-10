<script setup lang="ts">
/**
 * LLMConfigLimitsFields — shared `context_window` + `max_tokens_output`
 * inputs used by the global create/edit forms and the agent-scoped
 * AgentLlmConfigModal. Both fields are bound via v-model against the
 * parent form's `modelValue`.
 *
 * Absent / empty input is intentionally accepted and emitted as
 * `undefined` (not `null`) so the parent form's payload naturally
 * omits the key when the operator leaves the field blank — matching
 * the backend's "absent = leave unchanged" semantics.
 */
import { computed } from 'vue'

interface Limits {
  context_window: string
  max_tokens_output: string
}

const props = defineProps<{
  modelValue: Limits
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Limits]
}>()

const limits = computed({
  get: (): Limits => props.modelValue,
  set: (value: Limits): void => emit('update:modelValue', value),
})

function onContextWindow(event: Event): void {
  const target = event.target as HTMLInputElement | null
  limits.value = { ...limits.value, context_window: target?.value ?? '' }
}

function onMaxTokensOutput(event: Event): void {
  const target = event.target as HTMLInputElement | null
  limits.value = { ...limits.value, max_tokens_output: target?.value ?? '' }
}
</script>

<template>
  <div class="mb-5 space-y-4">
    <h3 class="text-sm font-semibold">Limits</h3>

    <div>
      <label class="block text-sm font-medium mb-1.5">Context window</label>
      <input
        :value="limits.context_window"
        type="number"
        min="1"
        inputmode="numeric"
        placeholder="e.g. 128000"
        autocomplete="off"
        class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        @input="onContextWindow"
      />
      <p class="text-xs text-muted-foreground mt-1">
        Total tokens the model can handle (input + output combined).
      </p>
    </div>

    <div>
      <label class="block text-sm font-medium mb-1.5">Max output tokens</label>
      <input
        :value="limits.max_tokens_output"
        type="number"
        min="1"
        inputmode="numeric"
        placeholder="e.g. 16384"
        autocomplete="off"
        class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        @input="onMaxTokensOutput"
      />
      <p class="text-xs text-muted-foreground mt-1">
        Token budget for the assistant's reply on a single turn. Leave
        blank to use the driver default.
      </p>
    </div>
  </div>
</template>