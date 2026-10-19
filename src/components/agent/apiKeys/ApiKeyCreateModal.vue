<script setup lang="ts">
/**
 * ApiKeyCreateModal — names a key and mints it.
 *
 * Deliberately minimal: one field. Scope, permissions and expiry are not
 * per-key concepts in Spora — a key is full access to its one agent — so
 * there is nothing else to ask for.
 */
import { ref, watch } from "vue";
import Modal from "@/components/Modal.vue";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    saving?: boolean;
  }>(),
  { saving: false },
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  create: [name: string];
  close: [];
}>();

const name = ref("");
const error = ref<string | null>(null);

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      name.value = "";
      error.value = null;
    }
  },
);

function submit(): void {
  // The name input stays enabled while the parent is saving, so a second
  // Enter reaches here. Two mints would mean two server rows and two
  // plaintexts — and the store keeps only the last, leaving the first key's
  // secret unrecoverable and the operator none the wiser. The parent owns the
  // in-flight state, so it is the one that decides.
  if (props.saving) return;

  const trimmed = name.value.trim();
  if (trimmed === "") {
    error.value = "A name is required.";
    return;
  }

  error.value = null;
  emit("create", trimmed);
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    title="New API key"
    size="sm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form
      class="flex flex-col gap-4"
      @submit.prevent="submit"
    >
      <label class="flex flex-col gap-1.5">
        <span class="text-sm font-medium text-foreground">Name</span>
        <input
          v-model="name"
          data-testid="api-key-name"
          type="text"
          maxlength="100"
          placeholder="n8n workflow"
          class="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        >
        <span class="text-xs text-muted-foreground">
          Something that tells you which integration this key belongs to.
        </span>
      </label>

      <p
        v-if="error"
        role="alert"
        class="text-sm text-destructive"
      >
        {{ error }}
      </p>
    </form>

    <template #footer>
      <button
        class="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
        type="button"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        data-testid="create-api-key"
        class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
        type="button"
        :disabled="saving"
        @click="submit"
      >
        Create key
      </button>
    </template>
  </Modal>
</template>
