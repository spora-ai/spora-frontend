<script setup lang="ts">
/**
 * AgentApiKeysSection — an agent's Agent API credentials, inside Settings.
 *
 * A thin wrapper around the shared `ApiKeysSection`: the agent scope is the
 * one that was there first, and its wording is the one that says what a key
 * reaches.
 */
import ApiKeysSection from '@/components/apiKeys/ApiKeysSection.vue'
import { API_KEY_SCOPE_PATHS } from '@/lib/apiKeyScopes'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  agentId: number
}>()
</script>

<template>
  <ApiKeysSection
    scope="agent"
    :target-id="props.agentId"
    :heading="t('API keys')"
    :setting-label="t('Agent API')"
  >
    <template #description>
      {{ t('Credentials for external tools driving this agent over the') }}
      <code>{{ API_KEY_SCOPE_PATHS.agent }}</code> {{ t("surface. A key reaches this agent's chats, their transcripts, and the media they produced — and nothing else.") }}
    </template>
  </ApiKeysSection>
</template>
