<script setup lang="ts">
/**
 * AgentApiKeysPage — an agent's Agent API credentials. Route: /agents/:id/api-keys.
 *
 * Mirrors AgentToolsPage: renders inside the shared AgentLayout chrome,
 * fetches the agent on mount, and watches `currentAgent` so a delete from
 * inside this page still bounces the user to the dashboard.
 *
 * The tab that reaches this page is rendered only while `SPORA_AGENT_API` is
 * on. The worker-runtime warning lives here rather than hiding the page,
 * because a key the operator already minted stays valid through a change of
 * worker mode and must not look revoked.
 */
import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAgentStore } from "@/stores/agent";
import { useRuntimeConfigStore } from "@/stores/runtimeConfig";
import { useToast } from "@/composables/useToast";
import AgentLayout from "@/components/layout/AgentLayout.vue";
import AlertBanner from "@/components/ui/AlertBanner.vue";
import ApiKeyTable from "@/components/agent/apiKeys/ApiKeyTable.vue";

const route = useRoute();
const router = useRouter();
const agentStore = useAgentStore();
const runtimeConfig = useRuntimeConfigStore();
const toast = useToast();

const agentId = computed(() => Number(route.params.id));
const clientWorker = computed(
  () => runtimeConfig.workerRuntimeMode === "client",
);

onMounted(async () => {
  await Promise.all([
    agentStore.fetchAgents(),
    agentStore.fetchAgent(agentId.value),
  ]);
});

watch(
  () => agentStore.currentAgent,
  (newAgent, oldAgent) => {
    if (oldAgent !== null && newAgent === null) {
      toast.success("Agent deleted");
      void router.push({ name: "dashboard" });
    }
  },
);
</script>

<template>
  <AgentLayout :agent-id="agentId">
    <div
      v-if="!agentStore.currentAgent"
      class="flex-1 px-6 py-8 text-sm text-muted-foreground"
    >
      Loading…
    </div>

    <main
      v-else
      class="flex-1 py-8 px-6 flex flex-col gap-8"
    >
      <AlertBanner
        v-if="clientWorker"
        type="warning"
        message="This instance runs in client-worker mode, where the browser drives the agent loop. The Agent API endpoints will answer 404 until Worker runtime mode is set to Server under Global Settings. Existing keys stay valid once it is."
      />

      <ApiKeyTable :agent-id="agentId" />
    </main>
  </AgentLayout>
</template>
