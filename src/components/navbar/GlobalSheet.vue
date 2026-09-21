<script setup lang="ts">
/**
 * GlobalSheet — right-anchored slide-in panel used by the navbar's ≡
 * button. Backed by a native `<dialog>` element so the user-agent
 * supplies focus trap, ESC-to-close, and inert background for free
 * (SonarQube Web:S6819). The right-anchored panel slides over the
 * dimmed backdrop using CSS transforms.
 *
 * Open state is fully controlled by the parent (`v-model:open`).
 * `showModal()` places the dialog in the top layer when `open` flips
 * true; the browser's own `close` event (Esc / form submit / explicit
 * `close()`) keeps `props.open` honest via the `onDialogClose`
 * handler below. Body scroll-lock is still applied manually — native
 * `<dialog>` does not lock body scroll.
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; close: [] }>()

const dialogEl = ref<HTMLDialogElement | null>(null)

function close(): void {
  emit('update:open', false)
  emit('close')
}

// Body scroll-lock while the sheet is open. Native <dialog> does not
// lock the page behind it — the backdrop is a modal surface and the
// page underneath shouldn't move on mobile.
function syncScrollLock(open: boolean): void {
  document.body.classList.toggle('overflow-hidden', open)
}

async function syncDialog(open: boolean): Promise<void> {
  const el = dialogEl.value
  if (open) {
    await nextTick()
    if (el !== null && !el.open) {
      el.showModal()
    }
  } else if (el !== null && el.open) {
    el.close()
  }
}

// Mirror the browser's own close event (Esc / native `close()`) back
// into our controlled state. Without this, the user-agent could close
// the dialog and `props.open` would drift out of sync.
function onDialogClose(): void {
  if (props.open) {
    close()
  }
}

// Belt-and-braces Esc handler. The native <dialog> already wires
// Esc-to-close via `onDialogClose` above, but happy-dom (the test
// environment) doesn't implement that dispatch, so we also listen on
// the window. Both paths are idempotent — whichever fires first sets
// `props.open` to false.
function onWindowKeyDown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && props.open) {
    close()
  }
}

watch(
  () => props.open,
  (open) => {
    syncScrollLock(open)
    void syncDialog(open)
    if (open) {
      window.addEventListener('keydown', onWindowKeyDown)
    } else {
      window.removeEventListener('keydown', onWindowKeyDown)
    }
  },
  { immediate: true },
)

// Defensive cleanup if the component unmounts while the sheet is open
// (logout unmounts the navbar mid-open). Without this the body stays
// scroll-locked forever.
onBeforeUnmount(() => {
  syncScrollLock(false)
  if (dialogEl.value?.open) {
    dialogEl.value.close()
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <dialog
        v-if="open"
        ref="dialogEl"
        aria-modal="true"
        class="fixed inset-0 z-50 m-0 h-screen w-screen max-w-none max-h-none p-0 border-0 bg-transparent backdrop:bg-foreground/40"
        @close="onDialogClose"
      >
        <button
          type="button"
          aria-label="Close menu"
          class="absolute inset-0 cursor-default"
          @click="close"
        />
        <div class="sheet-panel absolute right-0 top-0 bottom-0 w-[88%] max-w-sm bg-background border-l border-border shadow-2xl rounded-l-2xl flex flex-col overflow-hidden">
          <slot
            name="identity"
            :close="close"
          />
          <div class="flex-1 overflow-y-auto">
            <slot :close="close" />
          </div>
          <slot
            name="footer"
            :close="close"
          />
        </div>
      </dialog>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet-enter-active .sheet-panel,
.sheet-leave-active .sheet-panel {
  transition: transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.sheet-enter-from .sheet-panel,
.sheet-leave-to .sheet-panel {
  transform: translateX(100%);
}
</style>
