<script setup lang="ts">
/**
 * GlobalSheetIdentity — identity header at the top of the navbar sheet.
 * Renders the authenticated user's avatar, display name, email, and a
 * close button. Designed to be placed in the `identity` slot of
 * `<GlobalSheet>`.
 *
 * Reuses the existing `ui/Avatar.vue` for the picture — when the user
 * has no profile picture it falls back to initial letters, matching
 * the rest of the app's identity surfaces.
 */
import type { User } from '@/types/user'
import Avatar from '@/components/ui/Avatar.vue'
import Icon from '@/components/ui/Icon.vue'

defineProps<{ user: User | null }>()
const emit = defineEmits<{ close: [] }>()

function initials(name: string | null, email: string): string {
  const source = name ?? email
  return source.slice(0, 2).toUpperCase()
}
</script>

<template>
  <div class="relative px-5 pt-6 pb-5 bg-gradient-to-br from-primary/10 via-accent/10 to-background border-b border-border">
    <button
      type="button"
      aria-label="Close menu"
      class="absolute top-3 right-3 flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors"
      @click="emit('close')"
    >
      <Icon name="x" />
    </button>
    <div
      v-if="user"
      class="flex items-center gap-3"
    >
      <Avatar
        :initials="initials(user.name, user.email)"
        :profile-picture="null"
        size="lg"
        class="ring-2 ring-primary/40 ring-offset-2 ring-offset-background rounded-full"
      />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-foreground truncate">
          {{ user.name ?? user.email }}
        </p>
        <p class="text-xs text-muted-foreground truncate">
          {{ user.email }}
        </p>
      </div>
    </div>
  </div>
</template>
