<script setup lang="ts">
/**
 * AgentApiKeysSection — an agent's Agent API credentials, inside Settings.
 *
 * This was its own top-level tab, which made credentials compete with Chats
 * and Tools for attention. Keys are a rarely-touched, destructive-to-get-
 * wrong surface, so they read better as a settings section: findable, but not
 * shouting.
 *
 * The reveal-once contract is unchanged and still lives in `ApiKeyTable` and
 * the store; this wrapper only supplies the section chrome and the anchor.
 */
import { computed } from 'vue'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useFeatureEnabled } from '@/composables/useFeatureEnabled'
import ApiKeyTable from '@/components/agent/apiKeys/ApiKeyTable.vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

/** The API path the keys below belong to — a path, not copy. */
const AGENT_API_PATH = '/api/v1/agent-api/*'

const props = defineProps<{
  agentId: number
}>()

const runtimeConfig = useRuntimeConfigStore()
const featureEnabled = useFeatureEnabled('agent_api')

const clientWorker = computed(() => runtimeConfig.workerRuntimeMode === 'client')

/**
 * Both conditions that make `/api/v1/agent-api/*` answer 404.
 *
 * The route is reachable with the feature off, so an operator can still
 * revoke what they already minted. Both reasons have to be named: attributing
 * every 404 to worker mode sends someone to a file-only setting they cannot
 * change from the page, while the real cause is the toggle.
 */
const unavailableReason = computed<string | null>(() => {
  const causes: string[] = []

  if (!featureEnabled.value) {
    causes.push('the Agent API setting is off')
  }

  if (clientWorker.value) {
    causes.push(
      'this instance runs in client-worker mode, where the browser drives the agent loop (`SPORA_WORKER_RUNTIME_MODE=server` in `.env`, then restart)',
    )
  }

  if (causes.length === 0) return null

  return `The /api/v1/agent-api/* endpoints answer 404 because ${causes.join(' and ')}. The keys below are still yours to list and revoke, and they work again once the API is mounted.`
})
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
    <div class="flex flex-col gap-1">
      <h2 class="text-base font-semibold">
        {{ t('API keys') }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('Credentials for external tools driving this agent over the') }}
        <code>{{ AGENT_API_PATH }}</code> {{ t("surface. A key reaches this agent's chats, their transcripts, and the media they produced — and nothing else.") }}
      </p>
    </div>

    <p
      v-if="unavailableReason"
      role="alert"
      class="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground"
    >
      {{ unavailableReason }}
    </p>

    <ApiKeyTable :agent-id="props.agentId" />
  </section>
</template>
