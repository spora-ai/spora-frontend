<script setup lang="ts">
/**
 * AgentProfilePictureSection — agent-side wrapper around the
 * cross-subject `ProfilePictureSection`. Picture state and
 * save/upload/remove calls flow through the agent store; this file
 * exists so existing call sites (the agent settings page) keep
 * their import path stable. The action-bridging pattern is shared
 * with `GroupProfilePictureSection` via `useProfilePictureActions`.
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
const initials = computed<string>(() => props.agent.name.charAt(0).toUpperCase())
</script>

<template>
  <ProfilePictureSection
    subject="agent"
    :initials="initials"
    :profile-picture="profilePicture"
    v-bind="actions"
  />
</template>
