<script setup lang="ts">
/**
 * AgentApiKeysPage — an agent's Agent API credentials. Route: /agents/:id/api-keys.
 *
 * Mirrors AgentToolsPage: renders inside the shared AgentLayout chrome,
 * fetches the agent on mount, and watches `currentAgent` so a delete from
 * the agent store while this page is open bounces the user to the dashboard.
 *
 * The tab that reaches this page is hidden while `SPORA_AGENT_API` is off, but
 * the route is reachable by URL on purpose — the admin key endpoints are not
 * gated, so an operator must still be able to list and revoke what they
 * already minted. Both states where the bearer surface answers 404 are
 * therefore explained here rather than left to be discovered.
 */
import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAgentStore } from "@/stores/agent";
import { useRuntimeConfigStore } from "@/stores/runtimeConfig";
import { useToast } from "@/composables/useToast";
import { useFeatureEnabled } from "@/composables/useFeatureEnabled";
import AgentLayout from "@/components/layout/AgentLayout.vue";
import AlertBanner from "@/components/ui/AlertBanner.vue";
import ApiKeyTable from "@/components/agent/apiKeys/ApiKeyTable.vue";

const route = useRoute();
const router = useRouter();
const agentStore = useAgentStore();
const runtimeConfig = useRuntimeConfigStore();
const toast = useToast();

const agentId = computed(() => Number(route.params.id));
const featureEnabled = useFeatureEnabled("agent_api");
const clientWorker = computed(
  () => runtimeConfig.workerRuntimeMode === "client",
);

/**
 * Why the bearer surface would answer 404, or null when it would not.
 *
 * Both causes have to be named here. This page is reachable by URL with the
 * feature switched off, so an operator who lands here that way sees no tab
 * and no error — only a key list, with no way to tell that the API those keys
 * are for is not currently mounted.
 *
 * Worker runtime mode is a file-only setting read at boot, so it is changed in
 * `.env` (`SPORA_WORKER_RUNTIME_MODE=server`) and needs a restart — not saved
 * under Global Settings, where it is rendered read-only.
 */
const unavailableReason = computed<string | null>(() => {
  const causes: string[] = [];

  if (!featureEnabled.value) {
    causes.push("the **Agent API** setting is off");
  }

  if (clientWorker.value) {
    causes.push(
      "this instance runs in client-worker mode, where the browser drives the agent loop (`SPORA_WORKER_RUNTIME_MODE=server` in `.env`, then restart)",
    );
  }

  if (causes.length === 0) return null;

  return `The /api/v1/agent-api/* endpoints answer 404 because ${causes.join(" and ")}. The keys below are still yours to list and revoke, and they work again once the API is mounted.`;
});

onMounted(async () => {
  // `fetchAgent` does not swallow its own errors, so an unhandled rejection
  // here would leave the page on "Loading…" forever with no indication that
  // the agent is not loadable.
  try {
    await Promise.all([
      agentStore.fetchAgents(),
      agentStore.fetchAgent(agentId.value),
    ]);
  } catch {
    toast.error("Could not load this agent.");
  }
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
        v-if="unavailableReason"
        type="warning"
        :message="unavailableReason"
      />

      <ApiKeyTable :agent-id="agentId" />
    </main>
  </AgentLayout>
</template>
