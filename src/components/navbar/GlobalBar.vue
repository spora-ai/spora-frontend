<script setup lang="ts">
/**
 * GlobalBar — the unified top navigation bar. Five items max on every
 * breakpoint: logo, search input (desktop) or search icon (mobile), bell,
 * theme toggle, ≡ menu. Layout-only; the orchestrator owns open/close
 * and routes events to stores and composables.
 *
 * The bar takes a few props it needs to render and emits the actions
 * the orchestrator wires up. This keeps the bar fully testable in
 * isolation without mocking every store.
 */
import { ref } from 'vue'
import SearchInput from '@/components/ui/SearchInput.vue'
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

const searchQuery = ref('')

function onSearchKeyDown(ev: KeyboardEvent): void {
  if (ev.key === 'Enter') {
    emit('open-search')
  }
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
      <div
        v-if="loggedIn"
        class="hidden md:block w-64"
      >
        <SearchInput
          v-model="searchQuery"
          placeholder="Search…"
          aria-label="Search"
          @keydown="onSearchKeyDown"
        />
      </div>

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
