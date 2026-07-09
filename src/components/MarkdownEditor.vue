<script setup lang="ts">
/**
 * MarkdownEditor — thin wrapper around `md-editor-v3` exposing a Vue-idiomatic
 * `v-model: string` API for use across the Spora admin UI.
 *
 * Two visual modes:
 * - `bubble` (default for quick prompt inputs): no top toolbar, no preview pane,
 *   but a floating formatting menu appears on text selection.
 * - `full` (default for long-form fields): full top toolbar with formatting
 *   options + a live preview pane.
 *
 * Dark mode is auto-wired through `useThemeStore().isDark`.
 */
import { computed } from 'vue'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { useThemeStore } from '@/stores/theme'

type ToolbarName = import('md-editor-v3').ToolbarNames

const props = withDefaults(defineProps<{
  modelValue: string
  /** 'full' = top toolbar + preview; 'bubble' = textarea-like + floating selection menu. */
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

// `rows` × 24px line-height is a reasonable visual floor; the editor's own
// scroll handles anything longer.
const height = computed(() => `${Math.max(props.rows, 2) * 24 + 16}px`)

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

// Floating selection menu: small set, used in both modes (most useful in `bubble`).
const floatingToolbars = computed<ToolbarName[]>(() => [
  'bold', 'underline', 'italic',
  '-',
  'code', 'link',
  '-',
  'unorderedList', 'orderedList',
])

const previewEnabled = computed(() => props.mode === 'full')

// Two-way binding: pass `modelValue` straight through, and forward the
// library's `update:modelValue` emit. The library also fires `onChange`
// on every edit, but we deliberately don't listen to it here — that would
// cause a double-emit on every keystroke (the v-model path emits, then
// onChange emits again).

function onKeydown(e: KeyboardEvent): void {
  emit('keydown', e)
}
</script>

<template>
  <div
    class="md-editor-spora"
    :class="{
      'md-editor-spora--full': mode === 'full',
      'md-editor-spora--bubble': mode === 'bubble',
      'md-editor-spora--disabled': disabled,
    }"
  >
    <MdEditor
      :model-value="modelValue"
      :theme="resolvedTheme"
      :style="{ height }"
      :toolbars="topToolbars"
      :floating-toolbars="floatingToolbars"
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

/* ── Disabled state ─────────────────────────────────────────────────────── */
.md-editor-spora--disabled .md-editor {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>