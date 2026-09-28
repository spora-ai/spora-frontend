<script setup lang="ts">
/**
 * GlobalSheetIdentity — identity header at the top of the navbar sheet.
 * Renders the authenticated user's avatar, display name, email, and a
 * close button. The avatar + name + email block is clickable and
 * navigates to the account page (a single tap from anywhere — same
 * affordance the old avatar-in-bar provided).
 *
 * Reuses the shared `Avatar` for the picture — when the user has no
 * profile picture it falls back to initial letters, matching the rest
 * of the app's identity surfaces. The package derives the letters
 * from `name`, so this component hands it the display name and only
 * supplies the email as a fallback for users without one.
 */
import type { User } from '@/types/user'
import { Avatar } from '@spora-ai/components/avatar'
import { Icon } from '@spora-ai/components/icons'

defineProps<{ user: User | null }>()
const emit = defineEmits<{ close: []; navigate: [] }>()
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
    <button
      v-if="user"
      type="button"
      class="flex items-center gap-3 text-left rounded-lg -mx-2 px-2 py-1 hover:bg-background/60 transition-colors"
      aria-label="Open account"
      @click="emit('navigate')"
    >
      <Avatar
        :name="user.name ?? user.email"
        :profile-picture="user.profile_picture ?? null"
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
    </button>
  </div>
</template>
