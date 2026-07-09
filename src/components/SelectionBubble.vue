<script setup lang="ts">
/**
 * SelectionBubble — a minimal formatting popover that appears ONLY when the
 * user selects (non-collapsed) text inside a target element.
 *
 * Replaces `md-editor-v3`'s built-in `floatingToolbars` popover in bubble
 * mode. The library's built-in popover also fires on "cursor on a whitespace-
 * only line" (see md-editor-v3/lib/es/MdEditor.mjs around line 1837), which
 * means it shows as soon as the user focuses an empty composer — that's the
 * bug we are fixing here.
 *
 * Position: fixed, anchored above the selection's bounding rect.
 *
 * Buttons (intentionally minimal): bold, italic, underline, inline-code.
 * Link, lists, and other formatting are deliberately omitted to keep the
 * popover compact.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

export type BubbleFormat = 'bold' | 'italic' | 'underline' | 'code'

const props = defineProps<{
  /**
   * Lazy lookup for the contenteditable element. Called on every selection
   * change so the popover tracks the live node even if the editor swaps
   * the contenteditable surface internally (e.g. on theme / value updates).
   */
  getTarget: () => HTMLElement | null
  /** Optional disabled flag. */
  disabled?: boolean
}>()

const emit = defineEmits<{
  /** Emitted with the chosen format when a button is clicked. */
  format: [format: BubbleFormat]
}>()

// One declarative list drives both rendering and behavior — easier to keep
// "no link, no lists" in sync if we add more options later.
const buttons: ReadonlyArray<{ format: BubbleFormat; label: string; title: string; class: string }> = [
  { format: 'bold', label: 'B', title: 'Bold (⌘B)', class: 'md-selection-bubble__btn--bold' },
  { format: 'italic', label: 'I', title: 'Italic (⌘I)', class: 'md-selection-bubble__btn--italic' },
  { format: 'underline', label: 'U', title: 'Underline (⌘U)', class: 'md-selection-bubble__btn--underline' },
  { format: 'code', label: '</>', title: 'Inline code', class: 'md-selection-bubble__btn--mono' },
]

const visible = ref(false)
const pos = ref({ top: 0, left: 0 })

function isInsideTarget(node: Node, target: HTMLElement): boolean {
  return target.contains(node) || node === target
}

function selectionRect(target: HTMLElement): DOMRect | null {
  if (typeof window === 'undefined') return null
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  if (!isInsideTarget(range.commonAncestorContainer, target)) return null
  return range.getBoundingClientRect()
}

function computePosition(rect: DOMRect, target: HTMLElement): { top: number; left: number } {
  const fallbackTop = target.getBoundingClientRect().top + window.scrollY - 52
  const fallbackLeft = target.getBoundingClientRect().left + window.scrollX + target.offsetWidth / 2
  const top = rect.height > 0 ? rect.top + window.scrollY - 52 : fallbackTop
  const left = rect.width > 0 ? rect.left + window.scrollX + rect.width / 2 : fallbackLeft
  return { top, left }
}

function update(): void {
  if (props.disabled) {
    visible.value = false
    return
  }
  const target = props.getTarget()
  if (!target) {
    visible.value = false
    return
  }
  const rect = selectionRect(target)
  if (!rect) {
    visible.value = false
    return
  }
  pos.value = computePosition(rect, target)
  visible.value = true
}

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('selectionchange', update)
  }
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('selectionchange', update)
  }
})

function onFormat(format: BubbleFormat, e: MouseEvent): void {
  // Prevent the click from collapsing the selection (mousedown would
  // otherwise move the selection to the button itself). Guard against
  // non-cancelable synthetic events in test environments.
  if (e.cancelable) e.preventDefault()
  e.stopPropagation()
  emit('format', format)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="md-selection-bubble"
      role="toolbar"
      aria-label="Text formatting"
      :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
    >
      <button
        v-for="b in buttons"
        :key="b.format"
        type="button"
        class="md-selection-bubble__btn"
        :class="b.class"
        :title="b.title"
        @mousedown.prevent
        @click="onFormat(b.format, $event)"
      >{{ b.label }}</button>
    </div>
  </Teleport>
</template>

<style>
.md-selection-bubble {
  position: absolute;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
  box-shadow: 0 6px 16px -2px rgb(0 0 0 / 0.18), 0 2px 4px -1px rgb(0 0 0 / 0.08);
  z-index: 60;
  white-space: nowrap;
  user-select: none;
}
.md-selection-bubble__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border-radius: 0.375rem;
  background: transparent;
  color: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  border: 0;
}
.md-selection-bubble__btn:hover {
  background: hsl(var(--accent));
}
.md-selection-bubble__btn:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 1px;
}
.md-selection-bubble__btn--bold {
  font-weight: 700;
}
.md-selection-bubble__btn--italic {
  font-style: italic;
  font-weight: 500;
}
.md-selection-bubble__btn--underline {
  text-decoration: underline;
  font-weight: 500;
}
.md-selection-bubble__btn--mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 500;
  font-size: 0.75rem;
}
</style>