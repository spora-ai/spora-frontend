<script setup lang="ts">
/**
 * ApiKeyRevealModal — shows a freshly minted key exactly once.
 *
 * The plaintext exists in the browser for the length of this dialog and is
 * never fetched again: the server stores a SHA-256 digest and has no way to
 * reproduce it. So the copy button and the "I've copied it" confirmation are
 * the whole interaction — closing without copying loses the key and the
 * operator has to mint another.
 */
import { ref, watch } from 'vue'
import Modal from '@/components/Modal.vue'

const props = defineProps<{
  modelValue: boolean
  secret: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
}>()

const copied = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (open) copied.value = false
  },
)

async function copy(): Promise<void> {
  if (!props.secret) return
  try {
    await navigator.clipboard.writeText(props.secret)
    copied.value = true
  } catch {
    // Clipboard access can be refused; the value stays selectable on screen,
    // so failing silently here is better than clearing it.
  }
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    title="Your new API key"
    size="md"
    :backdrop-closable="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-4">
      <p class="text-sm text-muted-foreground">
        Copy this key now. It is shown once and cannot be retrieved again — Spora keeps only a
        SHA-256 digest — so if you lose it you will have to create a new one.
      </p>

      <div class="rounded-lg border border-border bg-muted/40 px-3 py-2">
        <code
          data-testid="api-key-secret"
          class="block break-all font-mono text-xs text-foreground select-all"
        >{{ secret }}</code>
      </div>

      <button
        data-testid="copy-api-key"
        class="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
        type="button"
        @click="copy"
      >
        {{ copied ? 'Copied' : 'Copy to clipboard' }}
      </button>
    </div>

    <template #footer>
      <button
        data-testid="acknowledge-api-key"
        class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        type="button"
        @click="emit('close')"
      >
        I've saved it
      </button>
    </template>
  </Modal>
</template>
