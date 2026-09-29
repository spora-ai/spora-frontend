<script setup lang="ts">
/**
 * `/account` wrapper around the cross-subject `ProfilePictureSection`.
 * The user pipeline is image-only — no archetype picker, no `commit`
 * patch. State flows through the auth store so the navbar identity
 * updates immediately on save.
 */
import { computed } from 'vue'
import ProfilePictureSection from './ProfilePictureSection.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const profilePicture = computed(() => auth.user?.profile_picture ?? null)
// Guard on emptiness, not nullish-ness: a cleared settings field writes ''
// back, which would survive `??` and render as '?' instead of the email.
const name = computed<string>(() => (auth.user?.name ?? '').trim() || auth.user?.email || '')

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
