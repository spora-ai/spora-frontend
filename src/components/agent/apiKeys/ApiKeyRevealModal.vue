<script setup lang="ts">
/**
 * ApiKeyRevealModal — shows a freshly minted key exactly once.
 *
 * The plaintext is never fetched again: the server stores a SHA-256 digest and
 * has no way to reproduce it. So the copy button and the "I've copied it"
 * confirmation are the whole interaction — closing without copying loses the key
 * and the operator has to mint another.
 *
 * Both dismissal routes must emit `close`, not just `update:modelValue`.
 * `Modal`'s header X calls its own `close()`, which emits *both*, while the
 * backdrop is disabled here — so forwarding only the v-model event would hide
 * this dialog while leaving the plaintext in the store for the rest of the
 * session, with no way left to reach it. `ApiKeyTable` also clears on unmount
 * as a backstop.
 */
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import Modal from "@/components/Modal.vue";

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  secret: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  close: [];
}>();

const copied = ref(false);
const copyFailed = ref(false);

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      copied.value = false;
      copyFailed.value = false;
    }
  },
);

async function copy(): Promise<void> {
  if (!props.secret) return;
  try {
    await navigator.clipboard.writeText(props.secret);
    copied.value = true;
    copyFailed.value = false;
  } catch {
    // Clipboard access can be refused, and an insecure origin has no
    // `navigator.clipboard` at all. The value stays selectable on screen, so
    // the failure has to say so — an operator who clicks "I've saved it"
    // believing the key was copied has lost it.
    copied.value = false;
    copyFailed.value = true;
  }
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="t('Your new API key')"
    size="md"
    :backdrop-closable="false"
    @update:model-value="emit('update:modelValue', $event)"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-4">
      <p class="text-sm text-muted-foreground">
        {{ t('Copy this key now. It is shown once and cannot be retrieved again — Spora keeps only a SHA-256 digest — so if you lose it you will have to create a new one.') }}
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
        {{ copied ? t('Copied') : t('Copy to clipboard') }}
      </button>

      <p
        v-if="copyFailed"
        data-testid="copy-api-key-failed"
        class="text-sm text-destructive"
      >
        {{ t('Copy failed — select the key manually') }}
      </p>
    </div>

    <template #footer>
      <button
        data-testid="acknowledge-api-key"
        class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        type="button"
        @click="emit('close')"
      >
        {{ t('I\'ve saved it') }}
      </button>
    </template>
  </Modal>
</template>
