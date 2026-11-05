<script setup lang="ts">
/**
 * GlobalApiKeysPage — admin management of the install-wide API keys.
 *
 * A global key reaches every group, their agents and their chats. It is the
 * widest credential Spora issues, so only a global admin can mint one and
 * the page says plainly what it reaches.
 *
 * Personal agents are not reachable through it: there is no user-scoped key,
 * and the global scope does not reach one.
 *
 * The page stays reachable whatever the scope's toggle says: the keys an
 * operator minted before it was switched off have to stay listable and
 * revocable, so the warning explains the 404 instead of hiding it. Minting
 * is the one thing the toggle gates — the section offers no button for it
 * while the scope is off.
 */
import { useAdminAuth } from '@/composables/useAdminAuth'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminForbidden from '@/components/admin/AdminForbidden.vue'
import ApiKeysSection from '@/components/apiKeys/ApiKeysSection.vue'
import { API_KEY_SCOPE_PATHS } from '@/lib/apiKeyScopes'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const { isAdmin } = useAdminAuth()
</script>

<template>
  <AdminForbidden v-if="!isAdmin" />

  <AdminSection
    v-else
    :title="t('Global API keys')"
    :description="t('Credentials for external tools driving every group of this install.')"
  >
    <ApiKeysSection
      scope="global"
      :target-id="null"
      :heading="t('API keys')"
      :setting-label="t('Global API')"
    >
      <template #description>
        {{ t('Credentials for external tools driving this install over the') }}
        <code>{{ API_KEY_SCOPE_PATHS.global }}</code> {{ t('surface. A key reaches every group, every agent a group owns, and their chats — but not the personal agents of individual users.') }}
      </template>
    </ApiKeysSection>
  </AdminSection>
</template>
