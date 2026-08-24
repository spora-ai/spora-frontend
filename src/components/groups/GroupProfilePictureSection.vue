<script setup lang="ts">
/**
 * GroupProfilePictureSection — group-side wrapper around the
 * cross-subject `ProfilePictureSection`. Picture state and
 * save/upload/remove calls flow through the groupDetail store. The
 * action-bridging pattern is shared with `AgentProfilePictureSection`
 * via `useProfilePictureActions`.
 */
import { computed } from 'vue'
import { useGroupDetailStore } from '@/stores/groupDetail'
import ProfilePictureSection from '@/components/profile/ProfilePictureSection.vue'
import { useProfilePictureActions } from '@/composables/useProfilePictureActions'
import type { Group } from '@/types/principal'

const props = defineProps<{
  group: Group
  groupId: number
}>()

const detailStore = useGroupDetailStore()
const actions = useProfilePictureActions(props.groupId, {
  update: detailStore.updateProfilePicture,
  upload: detailStore.uploadProfilePictureImage,
  remove: detailStore.deleteProfilePictureImage,
})

const profilePicture = computed(() => props.group.profile_picture ?? null)
const initials = computed<string>(() => (props.group.name || '?').charAt(0).toUpperCase())
</script>

<template>
  <ProfilePictureSection
    subject="group"
    :initials="initials"
    :profile-picture="profilePicture"
    v-bind="actions"
  />
</template>
