<script setup lang="ts">
/**
 * UserProfilePictureSection — `/account` page wrapper around the
 * cross-subject `ProfilePictureSection`. The user pipeline is image-
 * only — no archetype picker, no `commit` patch — so this wrapper
 * passes `subject="user"` with `showArchetypeTab={false}` and only
 * the `upload` / `remove` callbacks (no `commit`). State flows through
 * the auth store so the navbar identity updates immediately on save.
 */
import { computed } from 'vue'
import ProfilePictureSection from './ProfilePictureSection.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const profilePicture = computed(() => auth.user?.profile_picture ?? null)
// Fall back to the email so a user who never set a display name still
// gets a recognisable badge — the shared Avatar only knows how to
// derive initials from the string it is handed.
const name = computed<string>(() => auth.user?.name ?? auth.user?.email ?? '')

async function upload(file: File): Promise<void> {
  await auth.uploadProfilePicture(file)
}

async function remove(): Promise<void> {
  await auth.deleteProfilePicture()
}
</script>

<template>
  <ProfilePictureSection
    subject="user"
    :name="name"
    :profile-picture="profilePicture"
    :upload="upload"
    :remove="remove"
    :show-archetype-tab="false"
  />
</template>
