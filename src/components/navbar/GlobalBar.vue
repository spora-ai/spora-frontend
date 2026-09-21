<script setup lang="ts">
/**
 * GlobalBar — the unified top navigation bar. Five items max on every
 * breakpoint: logo, search trigger (desktop) or search icon (mobile),
 * bell, theme toggle, ≡ menu. Layout-only; the orchestrator owns
 * open/close and routes events to stores and composables.
 *
 * The desktop "search" is a styled button (not a real input) — clicking
 * it opens the global command palette directly. Real search input lives
 * inside the palette; the bar's trigger is just a discoverable affordance
 * for mouse-first users, with the keyboard shortcut ⌘K documented inline.
 */
import Icon from '@/components/ui/Icon.vue'
import LogoSvg from '@/assets/logo.svg?asset'

const props = defineProps<{
  unreadCount: number
  isDark: boolean
  loggedIn: boolean
  menuOpen: boolean
}>()

const emit = defineEmits<{
  'update:menuOpen': [value: boolean]
  'open-search': []
  'open-notifications': []
  'toggle-theme': []
}>()

function toggleMenu(): void {
  emit('update:menuOpen', !props.menuOpen)
}
</script>

<template>
  <header class="h-14 border-b border-border bg-background flex items-center px-4 gap-1.5 shrink-0">
    <RouterLink
      to="/"
      class="flex items-center gap-2 font-semibold tracking-tight text-foreground hover:opacity-80 transition-opacity"
    >
      <img
        :src="LogoSvg"
        alt="Spora"
        class="h-8 w-auto dark:invert"
      >
    </RouterLink>

    <slot name="status" />

    <div class="flex-1" />

    <div class="flex items-center gap-0.5">
      <button
        v-if="loggedIn"
        type="button"
        class="hidden md:flex w-64 h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
        aria-label="Search (⌘K)"
        @click="emit('open-search')"
      >
        <svg
          class="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle
            cx="11"
            cy="11"
            r="8"
          />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <span class="flex-1 text-left">Search…</span>
        <kbd class="inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 text-[10px] font-mono text-muted-foreground">⌘K</kbd>
      </button>

      <button
        v-if="loggedIn"
        type="button"
        class="md:hidden flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label="Search"
        @click="emit('open-search')"
      >
        <Icon name="search" />
      </button>

      <button
        type="button"
        class="relative flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label="Notifications"
        @click="emit('open-notifications')"
      >
        <Icon name="bell" />
        <span
          v-if="unreadCount > 0"
          class="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1"
        >
          {{ unreadCount > 99 ? '99+' : unreadCount }}
        </span>
      </button>

      <button
        type="button"
        class="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
        :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
        @click="emit('toggle-theme')"
      >
        <Icon
          v-if="isDark"
          name="sun"
        />
        <Icon
          v-else
          name="moon"
        />
      </button>

      <button
        type="button"
        class="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        :aria-expanded="menuOpen"
        aria-label="Open menu"
        @click="toggleMenu"
      >
        <Icon name="menu" />
      </button>
    </div>
  </header>
</template>
