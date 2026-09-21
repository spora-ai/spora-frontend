<script setup lang="ts">
/**
 * GlobalSheet — right-anchored slide-in panel used by the navbar's ≡
 * button. Provides the backdrop, slide-in animation, body scroll-lock
 * while open, and ESC-to-close. Renders an identity slot at the top,
 * a scrollable body slot in the middle, and an optional footer slot
 * pinned at the bottom.
 *
 * Open state is fully controlled by the parent (`v-model:open`). The
 * sheet is a one-way projection of `props.open`; the parent owns the
 * decision of when to open it.
 */
import { onBeforeUnmount, watch } from 'vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; close: [] }>()

function close(): void {
  emit('update:open', false)
  emit('close')
}

// Body scroll-lock while the sheet is open. Locking the document
// prevents the page behind the panel from scrolling on mobile — the
// backdrop is a modal surface and the page underneath shouldn't move.
function syncScrollLock(open: boolean): void {
  document.body.classList.toggle('overflow-hidden', open)
}

// ESC closes the sheet — the backdrop click does too, but keyboard
// users get the standard modal ESC behaviour for free.
function onKeyDown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && props.open) {
    close()
  }
}

watch(
  () => props.open,
  (open) => {
    syncScrollLock(open)
    if (open) {
      window.addEventListener('keydown', onKeyDown)
    } else {
      window.removeEventListener('keydown', onKeyDown)
    }
  },
  { immediate: true },
)

// Defensive cleanup if the component unmounts while the sheet is open
// (logout unmounts the navbar mid-open). Without this the body stays
// scroll-locked forever.
onBeforeUnmount(() => {
  syncScrollLock(false)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex"
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          aria-label="Close menu"
          class="flex-1 cursor-default bg-foreground/40"
          @click="close"
        />
        <div class="sheet-panel w-[88%] max-w-sm bg-background border-l border-border shadow-2xl rounded-l-2xl flex flex-col overflow-hidden">
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
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 200ms ease;
}
.sheet-enter-active .sheet-panel,
.sheet-leave-active .sheet-panel {
  transition: transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet-panel,
.sheet-leave-to .sheet-panel {
  transform: translateX(100%);
}
</style>
