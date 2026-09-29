<script setup lang="ts">
/**
 * Agent-side wrapper around the cross-subject `ProfilePictureSection`.
 * Exists so the agent settings page keeps a stable import path; the
 * action-bridging pattern is shared with `GroupProfilePictureSection`
 * via `useProfilePictureActions`.
 */
import { computed } from 'vue'
import { useAgentStore } from '@/stores/agent'
import ProfilePictureSection from '@/components/profile/ProfilePictureSection.vue'
import { useProfilePictureActions } from '@/composables/useProfilePictureActions'
import type { Agent } from '@/types/agent'

const props = defineProps<{
  agent: Agent
  agentId: number
}>()

const store = useAgentStore()
const actions = useProfilePictureActions(props.agentId, {
  update: store.updateProfilePicture,
  upload: store.uploadProfilePictureImage,
  remove: store.deleteProfilePictureImage,
})

const profilePicture = computed(() => props.agent.profile_picture ?? null)
</script>

<template>
  <ProfilePictureSection
    subject="agent"
    :name="agent.name"
    :profile-picture="profilePicture"
    v-bind="actions"
  />
</template>
