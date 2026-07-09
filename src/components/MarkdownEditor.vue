<script setup lang="ts">
/**
 * MarkdownEditor — thin wrapper around `md-editor-v3` exposing a Vue-idiomatic
 * `v-model: string` API for use across the Spora admin UI.
 *
 * Two visual modes:
 * - `bubble` (default for quick prompt inputs): no top toolbar, no preview,
 *   no character-count footer. A custom selection-only formatting popover
 *   (SelectionBubble.vue) appears when the user selects text inside the
 *   editor.
 * - `full` (default for long-form fields): full top toolbar with formatting
 *   options + a live preview pane.
 *
 * Dark mode is auto-wired through `useThemeStore().isDark`.
 */
import { computed, ref } from 'vue'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { useThemeStore } from '@/stores/theme'
import SelectionBubble, { type BubbleFormat } from '@/components/SelectionBubble.vue'

type ToolbarName = import('md-editor-v3').ToolbarNames

const props = withDefaults(defineProps<{
  modelValue: string
  /** 'full' = top toolbar + preview; 'bubble' = textarea-like + selection popover. */
  mode?: 'full' | 'bubble'
  /** Visual height hint; mapped to a pixel height for the editor. */
  rows?: number
  /** Force light/dark regardless of the global theme. 'auto' follows the theme store. */
  theme?: 'light' | 'dark' | 'auto'
  placeholder?: string
  /** 0 = no limit. */
  maxLength?: number
  disabled?: boolean
  /** Optional id for <label for> pairing. */
  id?: string
}>(), {
  mode: 'full',
  rows: 6,
  theme: 'auto',
  placeholder: '',
  maxLength: 0,
  disabled: false,
  id: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  /** Forwarded keydown events so consumers can hook Enter / Cmd+Enter. */
  keydown: [event: KeyboardEvent]
}>()

const themeStore = useThemeStore()

// `md-editor-v3` only accepts 'light' | 'dark' for its `theme` prop. Resolve
// 'auto' against the global theme store.
const resolvedTheme = computed<'light' | 'dark'>(() => {
  if (props.theme === 'light' || props.theme === 'dark') return props.theme
  return themeStore.isDark ? 'dark' : 'light'
})

// Bubble mode needs more vertical room than `full` mode (no toolbar takes that
// space) — use a larger multiplier and floor so the input fills the card
// without showing an internal scrollbar on initial render.
const height = computed(() => {
  const minRows = props.mode === 'bubble' ? 4 : 2
  const lineHeight = props.mode === 'bubble' ? 24 : 24
  const padding = props.mode === 'bubble' ? 32 : 16
  return `${Math.max(props.rows, minRows) * lineHeight + padding}px`
})

// Top toolbar: rich in `full` mode, hidden in `bubble` mode.
const topToolbars = computed<ToolbarName[]>(() => {
  if (props.mode === 'bubble') return []
  return [
    'bold', 'underline', 'italic', 'strikeThrough',
    '-',
    'title', 'sub', 'sup', 'quote',
    '-',
    'unorderedList', 'orderedList', 'task',
    '-',
    'code', 'codeRow', 'link', 'image', 'table',
    '-',
    'preview',
  ]
})

// In bubble mode we replace the library's built-in floating popover with our
// own selection-only one (SelectionBubble.vue). Pass an empty array here so
// the library doesn't render anything; the CSS below hides any stragglers.
const floatingToolbars = computed<ToolbarName[]>(() => [])
const footers = computed<Array<never>>(() => [])

const previewEnabled = computed(() => props.mode === 'full')

// Track our wrapper so we can locate the editor's contenteditable surface.
// We pass a *getter* (not a stored ref) to SelectionBubble so the popover
// always sees the live node — md-editor-v3 swaps the contenteditable
// surface on theme / value updates, so caching it would silently break
// selection tracking.
const rootEl = ref<HTMLDivElement | null>(null)
const editorRef = ref<InstanceType<typeof MdEditor> | null>(null)

function getEditableTarget(): HTMLElement | null {
  return rootEl.value?.querySelector('[contenteditable]') ?? null
}

// md-editor-v3's exposed instance API is untyped in our mock, so we reach
// into it via a narrow shape. The real library exports an ExposeParam type
// from `md-editor-v3`; for the wrapper we only need execCommand.
//
// `Function` is used to avoid naming a parameter (this repo's eslint config
// flags unused parameter names even inside type signatures).
interface EditorWithExec {
  execCommand?: Function
}

function onBubbleFormat(format: BubbleFormat): void {
  const ref = editorRef.value as (EditorWithExec & Element) | null
  const exec = ref?.execCommand
  if (typeof exec !== 'function') return
  const map: Record<BubbleFormat, string> = {
    bold: 'bold',
    italic: 'italic',
    underline: 'underline',
    code: 'code',
  }
  exec(map[format])
}

function onKeydown(e: KeyboardEvent): void {
  emit('keydown', e)
}
</script>

<template>
  <div
    ref="rootEl"
    class="md-editor-spora"
    :class="{
      'md-editor-spora--full': mode === 'full',
      'md-editor-spora--bubble': mode === 'bubble',
      'md-editor-spora--disabled': disabled,
    }"
  >
    <MdEditor
      ref="editorRef"
      :model-value="modelValue"
      :theme="resolvedTheme"
      :style="{ height }"
      :toolbars="topToolbars"
      :floating-toolbars="floatingToolbars"
      :footers="footers"
      :preview="previewEnabled"
      :placeholder="placeholder"
      :max-length="maxLength > 0 ? maxLength : undefined"
      :disabled="disabled"
      :show-toolbar-name="false"
      :id="id"
      language="en-US"
      @update:model-value="emit('update:modelValue', $event)"
      @keydown="onKeydown"
    />
    <SelectionBubble
      v-if="mode === 'bubble'"
      :get-target="getEditableTarget"
      :disabled="disabled"
      @format="onBubbleFormat"
    />
  </div>
</template>

<style>
/* ── Token-driven chrome — matches existing form fields ─────────────────── */
.md-editor-spora .md-editor {
  border-radius: 0.5rem;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.md-editor-spora .md-editor:focus-within {
  outline: none;
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 2px hsl(var(--ring) / 0.2);
}
.md-editor-spora .md-editor-toolbar {
  background: hsl(var(--muted) / 0.4);
  border-bottom: 1px solid hsl(var(--border));
}
.md-editor-spora .md-editor-input,
.md-editor-spora .md-editor-preview {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.md-editor-spora .md-editor-preview-wrapper {
  border-left: 1px solid hsl(var(--border));
}

/* ── Bubble mode: flatten chrome so the editor looks like a textarea ────── */
.md-editor-spora--bubble .md-editor {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  border-radius: 0;
}
.md-editor-spora--bubble .md-editor:focus-within {
  border-color: transparent;
  box-shadow: none;
}
.md-editor-spora--bubble .md-editor-toolbar {
  display: none;
}

/* ── Defensive: hide the library's built-in floating popover entirely ───── */
/* We replace it with our own SelectionBubble. The `floatingToolbars` prop is
 * already an empty array, but the CodeMirror decoration the library mounts
 * can still render — this rule ensures it's invisible regardless. */
.md-editor-spora--bubble .md-editor-floating-toolbar,
.md-editor-spora--bubble .md-editor-floating-toolbar-container,
.md-editor-spora--bubble [class*="floating-toolbar"] {
  display: none !important;
}

/* ── Disabled state ─────────────────────────────────────────────────────── */
.md-editor-spora--disabled .md-editor {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>