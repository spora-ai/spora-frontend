import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * useCommandPalette — singleton global state for the ⌘K palette.
 *
 * `isOpen`, `open`, `close`, and `toggle` are module-level so any
 * number of callers in any component share the same state. The
 * window-level `keydown` listener is ref-counted: it attaches when
 * the first caller mounts and detaches only when the last caller
 * unmounts. Ref-counting matters because both `GlobalNavbar.vue`
 * (which owns the search-icon click handler) and `CommandPalette.vue`
 * (which reads `isOpen` + `close`) call this composable — without
 * ref-counting, the hotkey fires twice and ⌘K is a no-op.
 *
 * Mount any number of times from any component; the listener is
 * registered exactly once and stays attached as long as at least
 * one caller is mounted.
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

// Module-level listener registry. The ref count tracks how many
// callers are currently mounted; the listener is attached on the
// 0→1 transition and removed on the 1→0 transition. Without this,
// two mounted callers (GlobalNavbar + CommandPalette) would each
// register their own listener and ⌘K would call toggle() twice.
let listenerCount = 0
let listenerAttached = false

function registerListener(): void {
  listenerCount++
  if (listenerAttached) return
  window.addEventListener('keydown', onKeydown)
  listenerAttached = true
}

function unregisterListener(): void {
  listenerCount = Math.max(0, listenerCount - 1)
  if (listenerCount === 0 && listenerAttached) {
    window.removeEventListener('keydown', onKeydown)
    listenerAttached = false
  }
}

export function useCommandPalette() {
  onMounted(registerListener)
  onBeforeUnmount(unregisterListener)

  return { isOpen, open, close, toggle }
}
