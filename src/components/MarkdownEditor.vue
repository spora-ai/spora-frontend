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
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { MdEditor, type ExposeParam } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { useThemeStore } from '@/stores/theme'
import { computeAutoGrowHeight } from '@/composables/useMarkdownEditorHeight'
import SelectionBubble, { type BubbleFormat } from '@/components/SelectionBubble.vue'

type ToolbarName = import('md-editor-v3').ToolbarNames

// `md-editor-v3`'s `ToolDirective` isn't exported, but `ExposeParam.execCommand`
// uses it as the accepted argument type. Inline-import the type so our map
// values are typed as the exact union the library accepts.
type ToolDirective = Parameters<NonNullable<ExposeParam['execCommand']>>[0]

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
  /**
   * When true, the editor grows with its content (between `rows * 24 + padding`
   * and `maxRows * 24 + padding`) instead of staying at a fixed height. Use
   * for chat-style inputs (single-line starting state, expands as the user
   * types multi-line content, caps at `maxRows`).
   */
  autoGrow?: boolean
  /** Cap for the auto-grown height, in rows. Ignored unless `autoGrow` is on. */
  maxRows?: number
}>(), {
  mode: 'full',
  rows: 6,
  theme: 'auto',
  placeholder: '',
  maxLength: 0,
  disabled: false,
  id: undefined,
  autoGrow: false,
  maxRows: 10,
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
// space) — use a larger min-rows and padding so the input fills the card
// without showing an internal scrollbar on initial render.
const LINE_HEIGHT_PX = 24
const minRowsForMode = computed(() => props.mode === 'bubble' ? 4 : 2)
const paddingForMode = computed(() => props.mode === 'bubble' ? 32 : 16)

// When autoGrow is on, the minimum is the requested rows (e.g. 1 for a
// follow-up input). When it's off, we honour the bubble-mode floor so the
// input always has a comfortable starting height.
const baseHeightPx = computed(() => {
  const rows = props.autoGrow
    ? Math.max(props.rows, 1)
    : Math.max(props.rows, minRowsForMode.value)
  return rows * LINE_HEIGHT_PX + paddingForMode.value
})

const maxHeightPx = computed(() =>
  props.maxRows * LINE_HEIGHT_PX + paddingForMode.value,
)

// Live height while autoGrow is on; null when not yet measured.
const measuredHeightPx = ref<number | null>(null)

const editorStyle = computed(() => {
  if (props.autoGrow) {
    return { height: `${measuredHeightPx.value ?? baseHeightPx.value}px` }
  }
  return { height: `${baseHeightPx.value}px` }
})

// `true` once the editor is pinned at `maxRows`. We use this to flip the
// scrollbar CSS — visible only when there is real overflow to scroll, hidden
// while the field is still growing.
const atCap = computed(() =>
  props.autoGrow
  && measuredHeightPx.value !== null
  && measuredHeightPx.value >= maxHeightPx.value,
)

// Read the contenteditable's natural content height and clamp it to
// [baseHeightPx, maxHeightPx]. `md-editor-v3` is built on CodeMirror 6, whose
// `.cm-content` contenteditable reports its full content height via
// `scrollHeight` even when the wrapper is currently shorter than the content
// (the scroller handles the visible-window clipping), so we can measure
// directly without temporarily expanding the wrapper.
function measure(): void {
  if (!props.autoGrow) return
  const target = getEditableTarget()
  if (!target) return
  measuredHeightPx.value = computeAutoGrowHeight({
    scrollHeight: target.scrollHeight,
    rows: props.rows,
    maxRows: props.maxRows,
    padding: paddingForMode.value,
  })
}

watch(() => props.modelValue, () => {
  if (props.autoGrow) nextTick(measure)
})

watch(() => props.autoGrow, (val) => {
  if (val) {
    nextTick(measure)
  } else {
    measuredHeightPx.value = null
  }
})

onMounted(() => {
  if (props.autoGrow) nextTick(measure)
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
    'pageFullscreen',
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

// `md-editor-v3` exports `ExposeParam` describing the public instance
// surface (including `execCommand`). Using it removes the unsound
// `as unknown as` cast and the unsafe `Function` type that masked the
// real shape — the public ref already exposes the right shape, and the
// map values are typed as the exact union the library accepts.
function onBubbleFormat(format: BubbleFormat): void {
  const editor = editorRef.value as ExposeParam | null
  const exec = editor?.execCommand
  if (typeof exec !== 'function') return
  const map: Record<BubbleFormat, ToolDirective> = {
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
      'md-editor-spora--auto-grow': autoGrow,
      'md-editor-spora--auto-grow-at-cap': atCap,
    }"
  >
    <MdEditor
      ref="editorRef"
      :model-value="modelValue"
      :theme="resolvedTheme"
      :style="editorStyle"
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

/* ── Auto-grow scrollbar: hide the library's custom JS scrollbar entirely
     and show a native browser scrollbar on `.cm-scroller` once the editor
     has hit `maxRows`.

     Why native instead of the library's custom track? The custom track
     is a child of the input wrapper, pinned to the right edge. When the
     container has `rounded-xl`, the bottom-right corner clips the track
     (the corner extends ~12 px inward, eating into the 6 px-wide track).
     That clipping reads as the scrollbar being "cut" at the bottom.

     A native scrollbar on `.cm-scroller` is clipped by the content
     area's `overflow: hidden` instead of the container's rounded
     border, so it sits cleanly inside the input without being eaten by
     the corner. ─────────────────────────────────────────────────────── */
.md-editor-spora--auto-grow .md-editor-custom-scrollbar__track,
.md-editor-spora--auto-grow .md-editor-custom-scrollbar__thumb,
.md-editor-spora--auto-grow-at-cap .md-editor-custom-scrollbar__track,
.md-editor-spora--auto-grow-at-cap .md-editor-custom-scrollbar__thumb {
  display: none !important;
  visibility: hidden !important;
}
.md-editor-spora--auto-grow-at-cap .cm-scroller {
  scrollbar-width: thin !important;
  scrollbar-color: hsl(var(--muted-foreground) / 0.5) transparent !important;
}
.md-editor-spora--auto-grow-at-cap .cm-scroller::-webkit-scrollbar {
  width: 6px !important;
  display: block !important;
}
.md-editor-spora--auto-grow-at-cap .cm-scroller::-webkit-scrollbar-track {
  background: transparent !important;
}
.md-editor-spora--auto-grow-at-cap .cm-scroller::-webkit-scrollbar-thumb {
  background: hsl(var(--muted-foreground) / 0.5) !important;
  border-radius: 3px !important;
  border: 1px solid transparent !important;
  background-clip: padding-box !important;
}
</style>