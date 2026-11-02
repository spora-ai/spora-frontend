<script setup lang="ts">
/**
 * ApiKeysSection — a scope's API credentials, with the chrome around them.
 *
 * Keys are a rarely-touched, destructive-to-get-wrong surface, so they read
 * better as a settings section than as a top-level tab: findable, but not
 * shouting.
 *
 * One section serves the three scopes. The heading, the explanation and the
 * name of the setting are the caller's — a group's keys and the install's
 * keys do not reach the same things — while the warning about a 404 and the
 * table itself are the same everywhere.
 *
 * The reveal-once contract is unchanged and still lives in `ApiKeyTable` and
 * the store; this wrapper only supplies the section chrome.
 */
import { computed } from 'vue'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useFeatureEnabled } from '@/composables/useFeatureEnabled'
import { API_KEY_SCOPE_FLAGS, API_KEY_SCOPE_PATHS } from '@/lib/apiKeyScopes'
import type { ApiKeyScope } from '@/types/apiKey'
import ApiKeyTable from '@/components/apiKeys/ApiKeyTable.vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  scope: ApiKeyScope
  /** The agent or group the keys belong to; null for the global scope. */
  targetId: number | null
  heading: string
  /** The name of the setting that mounts this scope, for the 404 warning. */
  settingLabel: string
}>()

const runtimeConfig = useRuntimeConfigStore()
const featureEnabled = useFeatureEnabled(() => API_KEY_SCOPE_FLAGS[props.scope])

const clientWorker = computed(() => runtimeConfig.workerRuntimeMode === 'client')

const apiPath = computed(() => API_KEY_SCOPE_PATHS[props.scope])

/**
 * Both conditions that make the scope's endpoints answer 404.
 *
 * The route is reachable with the feature off, so an operator can still
 * revoke what they already minted. Both reasons have to be named: attributing
 * every 404 to worker mode sends someone to a file-only setting they cannot
 * change from the page, while the real cause is the toggle.
 */
const unavailableReason = computed<string | null>(() => {
  const causes: string[] = []

  if (!featureEnabled.value) {
    causes.push(t('the {setting} setting is off', { setting: props.settingLabel }))
  }

  if (clientWorker.value) {
    causes.push(
      t('this instance runs in client-worker mode, where the browser drives the agent loop (`SPORA_WORKER_RUNTIME_MODE=server` in `.env`, then restart)'),
    )
  }

  if (causes.length === 0) return null

  // The separator carries its own spaces, because German sets "und" apart from
  // the words around it. It lives outside the sentence so the sentence does not
  // nest one template literal in another.
  const separator = ` ${t('and')} `

  return `${t('The {path} endpoints answer 404 because', { path: apiPath.value })} ${causes.join(separator)}. ${t('The keys below are still yours to list and revoke, and they work again once the API is mounted.')}`
})
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
    <div class="flex flex-col gap-1">
      <h2 class="text-base font-semibold">
        {{ heading }}
      </h2>
      <p class="text-sm text-muted-foreground">
        <slot name="description">
          {{ t('Credentials for external tools driving this over the') }}
          <code>{{ apiPath }}</code> {{ t('surface.') }}
        </slot>
      </p>
    </div>

    <p
      v-if="unavailableReason"
      role="alert"
      class="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground"
    >
      {{ unavailableReason }}
    </p>

    <ApiKeyTable
      :scope="props.scope"
      :target-id="props.targetId"
    />
  </section>
</template>
