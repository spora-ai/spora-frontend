<script setup lang="ts">
/**
 * ImageOverlay — fullscreen image preview. Opens via `v-model:open` and
 * renders inside a native `<dialog>` (ESC + focus trap from the browser,
 * backdrop via the `backdrop:` variant). URLs come from sanitised markdown
 * output, so `data:` URIs are already stripped.
 *
 * Usage:
 *   <ImageOverlay v-model:open="overlayOpen" :src="src" :alt="alt" />
 */
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { Icon } from '@spora-ai/components/icons'

interface Props {
  open: boolean
  src: string
  alt?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const dialogRef = ref<HTMLDialogElement | null>(null)

function close(): void {
  emit('update:open', false)
}

// `showModal()` returns undefined where dialog-modal is unsupported — fall
// through to the v-if-driven render.
watch(() => props.open, async (open) => {
  await nextTick()
  const dialog = dialogRef.value
  if (!dialog) return
  if (open && !dialog.open) {
    dialog.showModal?.()
  } else if (!open && dialog.open) {
    dialog.close?.()
  }
})

onBeforeUnmount(() => {
  if (dialogRef.value?.open) {
    dialogRef.value.close?.()
  }
})
</script>

<template>
  <Teleport to="body">
    <dialog
      v-if="open"
      ref="dialogRef"
      aria-modal="true"
      aria-label="Image preview"
      class="fixed inset-0 z-50 m-0 max-w-none max-h-none w-full h-full p-4 bg-transparent backdrop:bg-black/80 open:flex items-center justify-center"
      data-testid="image-overlay"
      @click.self="close"
      @keydown.esc="close"
      @cancel.prevent="close"
    >
      <button
        type="button"
        class="absolute right-4 top-4 rounded-full bg-background/90 p-2 text-foreground shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="Close image preview"
        data-testid="image-overlay-close"
        @click="close"
      >
        <Icon
          name="x"
          class="h-5 w-5"
        />
      </button>
      <img
        :src="src"
        :alt="alt ?? ''"
        class="max-h-[90vh] max-w-[90vw] rounded object-contain shadow-2xl"
        data-testid="image-overlay-img"
      >
    </dialog>
  </Teleport>
</template>
