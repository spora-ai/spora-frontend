<script setup lang="ts">
/**
 * AgentProfilePictureSection — thin agent-side wrapper around the
 * cross-subject `ProfilePictureSection`. All picture state and
 * save/upload/remove calls flow through the agent store; this file
 * exists so the existing call sites (the agent settings page) keep
 * their import path stable.
 */
import { computed } from 'vue'
import { useAgentStore } from '@/stores/agent'
import ProfilePictureSection from '@/components/profile/ProfilePictureSection.vue'
import type { Agent } from '@/types/agent'

const props = defineProps<{
  agent: Agent
  agentId: number
}>()

const agentStore = useAgentStore()

const profilePicture = computed(() => props.agent.profile_picture ?? null)
const initials = computed<string>(() => props.agent.name.charAt(0).toUpperCase())

async function commit(patch: { archetype?: string | null; variant_key?: string | null; palette_key?: string | null }): Promise<void> {
  await agentStore.updateProfilePicture(props.agentId, patch)
}

async function upload(file: File): Promise<void> {
  await agentStore.uploadProfilePictureImage(props.agentId, file)
}

async function remove(): Promise<void> {
  await agentStore.deleteProfilePictureImage(props.agentId)
}
</script>

<template>
  <ProfilePictureSection
    subject="agent"
    :initials="initials"
    :profile-picture="profilePicture"
    :commit="commit"
    :upload="upload"
    :remove="remove"
  />
</template>
