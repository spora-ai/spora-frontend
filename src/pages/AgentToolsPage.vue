<script setup lang="ts">
/**
 * AgentToolsPage — per-agent tool configuration. Route: /agents/:id/tools.
 *
 * Mirrors AgentSettingsPage: fetches the agent, wraps the tool registry in
 * AgentLayout, and watches `currentAgent` so a delete from inside a future
 * danger element here still bounces the user back to the dashboard. Today
 * only the tool list lives here, but the data-load and post-delete wiring
 * is the same template so future tool-page sub-sections (e.g. audit log of
 * tool invocations) can drop in without re-fetching the agent.
 */
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAgentStore } from '@/stores/agent'
import { useLlmConfigsStore } from '@/stores/llmConfigs'
import { useLlmPreferencesStore } from '@/stores/llmPreferencesStore'
import { useToast } from '@/composables/useToast'
import AgentLayout from '@/components/layout/AgentLayout.vue'
import AgentToolsSection from '@/components/agent/settings/AgentToolsSection.vue'

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
      <AgentToolsSection :agent="agentStore.currentAgent" :agent-id="agentId" />
    </main>
  </AgentLayout>
</template>
