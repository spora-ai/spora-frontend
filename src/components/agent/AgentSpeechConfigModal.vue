<script setup lang="ts">
/**
 * AgentSpeechConfigModal — inline "+ New" modal for agent-scope speech
 * configs. Mirrors AgentLlmConfigModal: opens an editor inside a Modal
 * instead of routing the operator to /settings/speech.
 *
 * Speech uses the same global / user / group / per-agent override
 * hierarchy as LLM, so the fast path from the agent page should match.
 * `SpeechProviderCreateForm` already calls the store's `upsert()` and
 * refreshes the cache; this modal is a thin host that wires the form's
 * `created` event to the parent so the new id can be auto-selected.
 */
import Modal from '@/components/Modal.vue'
import SpeechProviderCreateForm from '@/components/settings/speech/SpeechProviderCreateForm.vue'
import type {
  SpeechProviderClassSchema,
  SpeechProviderConfig,
} from '@/types/speechProviderConfig'

defineProps<{
  show: boolean
  providers: SpeechProviderClassSchema[]
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  created: [config: SpeechProviderConfig]
}>()

function onCreated(config: SpeechProviderConfig): void {
  emit('created', config)
  emit('update:show', false)
}
</script>

<template>
  <Modal
    :model-value="show"
    title="New Speech Provider"
    size="md"
    @update:model-value="(v: boolean) => emit('update:show', v)"
  >
    <SpeechProviderCreateForm
      scope="user"
      @created="onCreated"
      @cancel="emit('update:show', false)"
    />
  </Modal>
</template>
