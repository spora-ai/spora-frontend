<script setup lang="ts">
/**
 * GroupProfilePictureSection — thin group-side wrapper around the
 * cross-subject `ProfilePictureSection`. All picture state and
 * save/upload/remove calls flow through the groupDetail store; this
 * file exists so the existing call sites (the group settings page)
 * keep the wrapper pattern symmetrical with the agent side
 * (`AgentProfilePictureSection`).
 */
import { computed } from 'vue'
import { useGroupDetailStore } from '@/stores/groupDetail'
import ProfilePictureSection from '@/components/profile/ProfilePictureSection.vue'
import type { Group } from '@/types/principal'

const props = defineProps<{
  group: Group
  groupId: number
}>()

const detailStore = useGroupDetailStore()

const profilePicture = computed(() => props.group.profile_picture ?? null)
const initials = computed<string>(() => (props.group.name || '?').charAt(0).toUpperCase())

async function commit(patch: { archetype?: string | null; variant_key?: string | null; palette_key?: string | null }): Promise<void> {
  await detailStore.updateProfilePicture(props.groupId, patch)
}

async function upload(file: File): Promise<void> {
  await detailStore.uploadProfilePictureImage(props.groupId, file)
}

async function remove(): Promise<void> {
  await detailStore.deleteProfilePictureImage(props.groupId)
}
</script>

<template>
  <ProfilePictureSection
    subject="group"
    :initials="initials"
    :profile-picture="profilePicture"
    :commit="commit"
    :upload="upload"
    :remove="remove"
  />
</template>