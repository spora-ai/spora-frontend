<script setup lang="ts">
/**
 * CommandMenu — a small button that opens a list of commands.
 *
 * Modelled on {@see KebabMenu}, but the trigger carries a glyph of its own
 * and each row can carry one too. The chat uses it for the task commands
 * that do not belong in the composer itself.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@spora-ai/components/icons'

export interface CommandAction {
  id: string
  label: string
  /** One line of explanation under the label. */
  description?: string
  /** A bundled icon name, or a raw SVG path. */
  icon?: string
  disabled?: boolean
  onSelect: () => void
}

const props = withDefaults(defineProps<{
  actions: CommandAction[]
  /**
   * The glyph on the trigger button: a bundled icon name or a raw SVG path.
   *
   * The default is a shell prompt rather than a bundled name because the
   * `terminal` glyph ships in @spora-ai/components 0.1.2, which is not
   * published yet — the `Icon` component accepts a raw path as its name, so
   * the same shape renders either way.
   */
  icon?: string
  /** The trigger's accessible name. Empty falls back to a generic one. */
  ariaLabel?: string
  disabled?: boolean
  /**
   * Which way the panel opens. A trigger at the bottom of the viewport has
   * to open upwards, or the panel falls off the screen.
   */
  direction?: 'down' | 'up'
}>(), {
  icon: 'M5 7l5 5-5 5M12 17h7',
  ariaLabel: '',
  disabled: false,
  direction: 'down',
})

const { t } = useI18n()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function toggle(): void {
  open.value = !open.value
}

function close(): void {
  open.value = false
}

function run(action: CommandAction): void {
  if (action.disabled) return
  // Close first so the menu is gone before the action changes the view.
  close()
  action.onSelect()
}

function onDocumentClick(event: MouseEvent): void {
  if (!open.value) return
  const target = event.target as Node | null
  if (root.value && target && !root.value.contains(target)) {
    close()
  }
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open.value) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div
    ref="root"
    class="relative inline-block"
  >
    <button
      type="button"
      :aria-label="props.ariaLabel || t('Commands')"
      :aria-haspopup="true"
      :aria-expanded="open"
      :disabled="props.disabled"
      class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:pointer-events-none"
      data-testid="command-menu-trigger"
      @click.stop="toggle"
    >
      <Icon
        :name="props.icon"
        class="h-3.5 w-3.5"
        aria-hidden="true"
      />
    </button>

    <div
      v-if="open"
      role="menu"
      class="absolute left-0 z-20 min-w-[14rem] overflow-hidden rounded-lg border border-border bg-background shadow-lg"
      :class="props.direction === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'"
      data-testid="command-menu"
    >
      <button
        v-for="action in actions"
        :key="action.id"
        type="button"
        role="menuitem"
        :disabled="action.disabled"
        :data-testid="`command-menu-item-${action.id}`"
        class="flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
        @click="run(action)"
      >
        <Icon
          v-if="action.icon"
          :name="action.icon"
          class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span class="min-w-0">
          <span class="block font-medium text-foreground">{{ action.label }}</span>
          <span
            v-if="action.description"
            class="block text-xs text-muted-foreground"
          >{{ action.description }}</span>
        </span>
      </button>
    </div>
  </div>
</template>
