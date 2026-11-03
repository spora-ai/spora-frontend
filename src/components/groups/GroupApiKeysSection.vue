<script setup lang="ts">
/**
 * GroupApiKeysSection — a group's Group API credentials, inside Settings.
 *
 * A group's key reaches every agent of the group and their chats — the
 * group's own surface, not the install's. A personal agent is not reachable
 * through it.
 */
import ApiKeysSection from '@/components/apiKeys/ApiKeysSection.vue'
import { API_KEY_SCOPE_PATHS } from '@/lib/apiKeyScopes'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  groupId: number
}>()
</script>

<template>
  <ApiKeysSection
    scope="group"
    :target-id="props.groupId"
    :heading="t('API keys')"
    :setting-label="t('Group API')"
  >
    <template #description>
      {{ t('Credentials for external tools driving this group over the') }}
      <code>{{ API_KEY_SCOPE_PATHS.group }}</code> {{ t('surface. A key reaches every agent of this group, their chats, and the media they produced — and nothing outside the group.') }}
    </template>
  </ApiKeysSection>
</template>
