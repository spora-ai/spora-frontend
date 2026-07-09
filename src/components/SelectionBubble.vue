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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export type BubbleFormat = 'bold' | 'italic' | 'underline' | 'code'

const props = defineProps<{
  /** The contenteditable element to track selections within. */
  target: HTMLElement | null
  /** Optional disabled flag. */
  disabled?: boolean
}>()

const emit = defineEmits<{
  /** Emitted with the chosen format when a button is clicked. */
  format: [format: BubbleFormat]
}>()

const visible = ref(false)
const pos = ref({ top: 0, left: 0 })

const hasTarget = computed(() => props.target != null)

function update(): void {
  if (props.disabled || !props.target) {
    visible.value = false
    return
  }
  const sel = typeof window !== 'undefined' ? window.getSelection() : null
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    visible.value = false
    return
  }
  const range = sel.getRangeAt(0)
  // Only show when the selection is fully inside our target element.
  const target = props.target
  if (
    !target.contains(range.commonAncestorContainer) &&
    range.commonAncestorContainer !== target
  ) {
    visible.value = false
    return
  }
  const rect = range.getBoundingClientRect()
  // Popover is 44px tall; place it 8px above the selection. If the rect is
  // empty (e.g. selection is in a non-rendered test environment), fall back
  // to placing it near the target so the popover still renders.
  const top = rect.height > 0 ? rect.top + window.scrollY - 52 : target.getBoundingClientRect().top + window.scrollY - 52
  const left = rect.width > 0
    ? rect.left + window.scrollX + rect.width / 2
    : target.getBoundingClientRect().left + window.scrollX + target.offsetWidth / 2
  pos.value = { top, left }
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

function onFormat(fmt: BubbleFormat, e: MouseEvent): void {
  // Prevent the click from collapsing the selection (mousedown would
  // otherwise move the selection to the button itself).
  e.preventDefault()
  e.stopPropagation()
  emit('format', fmt)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && hasTarget"
      class="md-selection-bubble"
      role="toolbar"
      aria-label="Text formatting"
      :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
    >
      <button
        type="button"
        class="md-selection-bubble__btn"
        title="Bold (⌘B)"
        @mousedown.prevent
        @click="onFormat('bold', $event)"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        class="md-selection-bubble__btn md-selection-bubble__btn--italic"
        title="Italic (⌘I)"
        @mousedown.prevent
        @click="onFormat('italic', $event)"
      >
        I
      </button>
      <button
        type="button"
        class="md-selection-bubble__btn md-selection-bubble__btn--underline"
        title="Underline (⌘U)"
        @mousedown.prevent
        @click="onFormat('underline', $event)"
      >
        U
      </button>
      <span class="md-selection-bubble__sep" aria-hidden="true" />
      <button
        type="button"
        class="md-selection-bubble__btn md-selection-bubble__btn--mono"
        title="Inline code"
        @mousedown.prevent
        @click="onFormat('code', $event)"
      >
        &lt;/&gt;
      </button>
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
.md-selection-bubble__btn--italic {
  font-style: italic;
}
.md-selection-bubble__btn--underline {
  text-decoration: underline;
}
.md-selection-bubble__btn--mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 500;
}
.md-selection-bubble__sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: hsl(var(--border));
}
</style>