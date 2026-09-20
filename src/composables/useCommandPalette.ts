import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * useCommandPalette — singleton global state for the ⌘K palette.
 *
 * Mount once from `GlobalNavbar.vue`; the palette component then
 * reads `isOpen` and calls `open()` / `close()` / `toggle()` on
 * activation. Multiple callers share the same `isOpen` ref via the
 * module-level singleton, so any component can flip it from anywhere.
 *
 * Hotkey binding is registered in `onMounted` and torn down in
 * `onBeforeUnmount` so router-driven remounts don't accumulate
 * listeners. Matches the manual addEventListener pattern at
 * `GlobalNavbar.vue:88-94` for consistency with the codebase's
 * existing global-event conventions.
 *
 * @example
 *   // In GlobalNavbar.vue (script setup):
 *   const { isOpen, toggle } = useCommandPalette()
 *   // Bind a search-icon click to toggle, and a separate
 *   // <CommandPalette /> reads isOpen + close() to render.
 */
const isOpen = ref(false)

function open(): void {
  isOpen.value = true
}

function close(): void {
  isOpen.value = false
}

function toggle(): void {
  isOpen.value = !isOpen.value
}

function onKeydown(e: KeyboardEvent): void {
  const k = e.key.toLowerCase()
  if ((e.metaKey || e.ctrlKey) && k === 'k') {
    e.preventDefault()
    toggle()
  } else if (k === 'escape' && isOpen.value) {
    e.preventDefault()
    close()
  }
}

export function useCommandPalette() {
  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

  return { isOpen, open, close, toggle }
}