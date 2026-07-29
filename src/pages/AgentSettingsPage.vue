<script setup lang="ts">
/**
 * AgentSettingsPage — agent configuration. Route: /agents/:id/settings.
 *
 * A thin layout shell that fetches the agent, then delegates the four
 * sections (Identity, LLM, Tools, Danger Zone) to focused sub-components.
 *
 * Post-delete redirect: when the danger-zone child deletes the agent, the
 * store clears `currentAgent`. Watching that state change is more reliable
 * than listening to the child's `@deleted` event — the child unmounts in
 * the same microtask window as the store mutation, and the listener can be
 * detached before the parent's `onDeleted` runs. A state-driven watch
 * fires regardless of component-lifecycle ordering.
 */
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAgentStore } from '@/stores/agent'
import { useLlmConfigsStore } from '@/stores/llmConfigs'
import { useLlmPreferencesStore } from '@/stores/llmPreferencesStore'
import { useToast } from '@/composables/useToast'
import AgentLayout from '@/components/layout/AgentLayout.vue'
import AgentIdentitySection from '@/components/agent/settings/AgentIdentitySection.vue'
import AgentNotesSection from '@/components/agent/settings/AgentNotesSection.vue'
import AgentLlmSection from '@/components/agent/settings/AgentLlmSection.vue'
import AgentToolsSection from '@/components/agent/settings/AgentToolsSection.vue'
import AgentDangerZone from '@/components/agent/settings/AgentDangerZone.vue'

const route = useRoute()
const router = useRouter()
const agentStore = useAgentStore()
const llmConfigsStore = useLlmConfigsStore()
const preferenceStore = useLlmPreferencesStore()
const toast = useToast()

const agentId = computed(() => Number(route.params.id))

onMounted(async () => {
  await Promise.all([
    agentStore.fetchAgents(),
    agentStore.fetchAgent(agentId.value),
    llmConfigsStore.ensure(),
    preferenceStore.loadPreference(),
  ])
})

watch(
  () => agentStore.currentAgent,
  (newAgent, oldAgent) => {
    if (oldAgent !== null && newAgent === null) {
      toast.success('Agent deleted')
      void router.push({ name: 'dashboard' })
    }
  },
)
</script>

<template>
  <AgentLayout :agent-id="agentId">
    <div v-if="!agentStore.currentAgent" class="flex-1 flex items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>

    <main v-else class="flex-1 py-8 px-6 flex flex-col gap-8">
      <AgentIdentitySection :agent="agentStore.currentAgent" :agent-id="agentId" />
      <AgentNotesSection :agent="agentStore.currentAgent" :agent-id="agentId" />
      <AgentLlmSection :agent="agentStore.currentAgent" :agent-id="agentId" />
      <AgentToolsSection :agent="agentStore.currentAgent" :agent-id="agentId" />
      <AgentDangerZone :agent="agentStore.currentAgent" :agent-id="agentId" />
    </main>
  </AgentLayout>
</template>
