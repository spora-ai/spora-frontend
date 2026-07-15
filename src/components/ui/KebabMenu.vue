<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

export interface KebabAction {
  id: string
  label: string
  danger?: boolean
  onClick: () => void
}

withDefaults(defineProps<{
  actions: KebabAction[]
  ariaLabel?: string
}>(), {
  ariaLabel: 'More actions',
})

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function toggle(): void {
  open.value = !open.value
}

function close(): void {
  open.value = false
}

function run(action: KebabAction): void {
  // Close first so consumers can re-mount without the panel still being open.
  close()
  action.onClick()
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
  <div ref="root" class="relative inline-block">
    <button
      type="button"
      :aria-label="ariaLabel"
      :aria-haspopup="true"
      :aria-expanded="open"
      class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      @click.stop="toggle"
    >
      <svg
        class="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="5" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="12" cy="19" r="1" />
      </svg>
    </button>

    <div
      v-if="open"
      role="menu"
      class="absolute right-0 top-full z-20 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-border bg-background shadow-lg"
    >
      <button
        v-for="action in actions"
        :key="action.id"
        type="button"
        role="menuitem"
        :class="[
          'block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
          action.danger ? 'text-destructive' : 'text-foreground',
        ]"
        @click="run(action)"
      >
        {{ action.label }}
      </button>
    </div>
  </div>
</template>